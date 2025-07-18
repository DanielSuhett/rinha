import { Injectable, Logger } from '@nestjs/common';
import { PaymentDto } from '../payment/payment.dto';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { ConfigService } from '../config/config.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { CircuitBreakerService } from './circuit-breaker.service';

@Injectable()
export class ProcessorService {
	private readonly defaultProcessorUrl: string;
	private readonly fallbackProcessorUrl: string;
	private readonly PROCESSED_PAYMENTS_PREFIX = 'processed:payments';
	private readonly BATCH_SIZE = 50;
	private readonly BATCH_TIMEOUT = 1000;

	private pendingPayments: Array<{
		processorType: 'default' | 'fallback';
		amount: number;
		requestedAt: string;
		correlationId: string;
	}> = [];
	private batchTimer: NodeJS.Timeout | null = null;

	constructor(
		private readonly httpService: HttpService,
		private readonly configService: ConfigService,
		@InjectRedis() private readonly redis: Redis,
		private readonly logger: Logger,
		private readonly circuitBreakerService: CircuitBreakerService,
	) {
		this.defaultProcessorUrl = this.configService.getProcessorDefaultUrl();
		this.fallbackProcessorUrl = this.configService.getProcessorFallbackUrl();
	}

	newPayment(paymentDto: PaymentDto) {
		const requestedAt = new Date().toISOString();

		const payment = {
			...paymentDto,
			requestedAt,
		};

		return payment;
	}

	async processPayment(data: PaymentDto): Promise<string> {
		const payment = this.newPayment(data);

		try {
			const response = await lastValueFrom(
				this.httpService.post(`${this.defaultProcessorUrl}/payments`, payment),
			);

			if (response.status === 200) {
				this.persistProcessedPaymentAsync(
					'default',
					payment.amount,
					payment.requestedAt,
					payment.correlationId,
				);
			}
		} catch (error) {
			const errorMessage = this.extractErrorMessage(error);
			this.logger.error(
				`Error processing payment with default processor: ${errorMessage}`,
			);
			
			if (error?.response?.status === 500) {
				this.circuitBreakerService.reportProcessorFailure('default');
			}
			
			throw error;
		}

		return 'Payment processed!';
	}

	async processFallbackPayment(data: PaymentDto): Promise<string> {
		const payment = this.newPayment(data);

		try {
			const response = await lastValueFrom(
				this.httpService.post(`${this.fallbackProcessorUrl}/payments`, payment),
			);
			if (response.status === 200) {
				this.persistProcessedPaymentAsync(
					'fallback',
					payment.amount,
					payment.requestedAt,
					payment.correlationId,
				);
			}
		} catch (error) {
			const errorMessage = this.extractErrorMessage(error);
			this.logger.error(
				`Error processing payment with fallback processor: ${errorMessage}`,
			);
			
			if (error?.response?.status === 500) {
				this.circuitBreakerService.reportProcessorFailure('fallback');
			}
			
			throw error;
		}

		return 'Payment fallback processed!';
	}

	private extractErrorMessage(error: any): string {
		if (error?.response) {
			return `HTTP ${error.response.status} - ${error.response.statusText || 'Unknown'} (${error.config?.url || 'unknown URL'})`;
		}
		if (error?.code) {
			return `${error.code}: ${error.message}`;
		}
		return error?.message || 'Unknown error';
	}

	private persistProcessedPaymentAsync(
		processorType: 'default' | 'fallback',
		amount: number,
		requestedAt: string,
		correlationId: string,
	) {
		this.pendingPayments.push({
			processorType,
			amount,
			requestedAt,
			correlationId,
		});

		if (this.pendingPayments.length >= this.BATCH_SIZE) {
			this.flushBatch().catch((e) => {
				this.logger.error(
					`Error flushing batch: ${this.extractErrorMessage(e)}`,
				);
			});
		} else if (!this.batchTimer) {
			this.batchTimer = setTimeout(() => {
				this.flushBatch().catch((e) => {
					this.logger.error(
						`Error flushing batch: ${this.extractErrorMessage(e)}`,
					);
				});
			}, this.BATCH_TIMEOUT);
		}
	}

	private async flushBatch(): Promise<void> {
		if (this.pendingPayments.length === 0) {
			return;
		}

		const paymentsToProcess = [...this.pendingPayments];
		this.pendingPayments = [];

		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}

		try {
			const pipeline = this.redis.pipeline();
			const processedKeys = new Set<string>();

			for (const payment of paymentsToProcess) {
				const timestamp = new Date(payment.requestedAt).getTime();
				const paymentRecord = {
					amount: payment.amount,
					requestedAt: payment.requestedAt,
					processorType: payment.processorType,
					timestamp,
					correlationId: payment.correlationId,
				};

				const timelineKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${payment.processorType}:timeline`;

				pipeline.zadd(timelineKey, timestamp, JSON.stringify(paymentRecord));

				if (!processedKeys.has(timelineKey)) {
					processedKeys.add(timelineKey);
				}
			}

			await pipeline.exec();
		} catch (error) {
			const correlationIds = paymentsToProcess
				.map((p) => p.correlationId)
				.join(', ');
			this.logger.error(
				`Failed to persist payment batch [${correlationIds}]: ${this.extractErrorMessage(error)}`,
			);
		}
	}

	async getPaymentRecords(
		from?: string,
		to?: string,
	): Promise<{
		default: any[];
		fallback: any[];
	}> {
		try {
			const fromDate = from ? new Date(from) : undefined;
			const toDate = to ? new Date(to) : undefined;

			const fromTime = fromDate?.getTime() ?? undefined;
			const toTime = toDate?.getTime() ?? undefined;

			const defaultRecords = await this.getProcessedPaymentRecords(
				'default',
				fromTime,
				toTime,
			);

			const fallbackRecords = await this.getProcessedPaymentRecords(
				'fallback',
				fromTime,
				toTime,
			);

			return {
				default: defaultRecords,
				fallback: fallbackRecords,
			};
		} catch (error) {
			const errorMessage = this.extractErrorMessage(error);
			this.logger.error(`Error in getPaymentRecords: ${errorMessage}`);
			throw error;
		}
	}

	private async getProcessedPaymentRecords(
		processorType: 'default' | 'fallback',
		fromTime?: number,
		toTime?: number,
	): Promise<any[]> {
		try {
			const timelineKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${processorType}:timeline`;

			let paymentList: string[];

			if (fromTime !== undefined || toTime !== undefined) {
				const min = fromTime ?? 0;
				const max = toTime ?? '+inf';

				paymentList = await Promise.race([
					this.redis.zrangebyscore(timelineKey, min, max),
					new Promise<string[]>((_, reject) =>
						setTimeout(
							() => reject(new Error('Redis operation timeout')),
							2000,
						),
					),
				]);
			} else {
				paymentList = await Promise.race([
					this.redis.zrange(timelineKey, 0, -1),
					new Promise<string[]>((_, reject) =>
						setTimeout(
							() => reject(new Error('Redis operation timeout')),
							2000,
						),
					),
				]);
			}

			if (paymentList.length === 0) {
				return [];
			}

			const payments = paymentList
				.map((paymentStr) => {
					try {
						return JSON.parse(paymentStr);
					} catch (error) {
						this.logger.error(
							`Failed to parse payment JSON: ${paymentStr} - ${error?.message || 'Unknown parsing error'}`,
						);
						return null;
					}
				})
				.filter(Boolean);

			return payments;
		} catch (error) {
			const errorMessage = this.extractErrorMessage(error);
			this.logger.error(
				`Error getting processor records for ${processorType}: ${errorMessage}`,
			);
			return [];
		}
	}

	async getPaymentSummary(
		from?: string,
		to?: string,
	): Promise<{
		default: { totalRequests: number; totalAmount: number };
		fallback: { totalRequests: number; totalAmount: number };
	}> {
		try {
			const fromDate = from ? new Date(from) : undefined;
			const toDate = to ? new Date(to) : undefined;

			const fromTime = fromDate?.getTime() ?? undefined;
			const toTime = toDate?.getTime() ?? undefined;

			const defaultStats = await this.getProcessedPaymentStats(
				'default',
				fromTime,
				toTime,
			);

			const fallbackStats = await this.getProcessedPaymentStats(
				'fallback',
				fromTime,
				toTime,
			);

			const result = {
				default: defaultStats,
				fallback: fallbackStats,
			};

			return result;
		} catch (error) {
			const errorMessage = this.extractErrorMessage(error);
			this.logger.error(`Error in getPaymentSummary: ${errorMessage}`);
			throw error;
		}
	}

	private async getProcessedPaymentStats(
		processorType: 'default' | 'fallback',
		fromTime?: number,
		toTime?: number,
	): Promise<{ totalRequests: number; totalAmount: number }> {
		try {
			const timelineKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${processorType}:timeline`;

			let paymentList: string[];

			if (fromTime !== undefined || toTime !== undefined) {
				const min = fromTime ?? 0;
				const max = toTime ?? '+inf';

				paymentList = await Promise.race([
					this.redis.zrangebyscore(timelineKey, min, max),
					new Promise<string[]>((_, reject) =>
						setTimeout(
							() => reject(new Error('Redis operation timeout')),
							2000,
						),
					),
				]);
			} else {
				paymentList = await Promise.race([
					this.redis.zrange(timelineKey, 0, -1),
					new Promise<string[]>((_, reject) =>
						setTimeout(
							() => reject(new Error('Redis operation timeout')),
							2000,
						),
					),
				]);
			}

			if (paymentList.length === 0) {
				return { totalRequests: 0, totalAmount: 0 };
			}

			const payments = paymentList
				.map((paymentStr) => {
					try {
						return JSON.parse(paymentStr);
					} catch (error) {
						this.logger.error(
							`Failed to parse payment JSON: ${paymentStr} - ${error?.message || 'Unknown parsing error'}`,
						);
						return null;
					}
				})
				.filter(Boolean);

			const totalRequests = payments.length;
			const totalAmount = payments.reduce(
				(sum, payment) => sum + payment.amount,
				0,
			);

			return {
				totalRequests,
				totalAmount,
			};
		} catch (error) {
			const errorMessage = this.extractErrorMessage(error);
			this.logger.error(
				`Error getting processor stats for ${processorType}: ${errorMessage}`,
			);
			return { totalRequests: 0, totalAmount: 0 };
		}
	}

	onDestroy(): void {
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}
		this.flushBatch();
	}
}
