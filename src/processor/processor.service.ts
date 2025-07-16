import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PaymentDto } from '../payment/payment.dto';
import { HttpService } from '@nestjs/axios';
import { catchError } from 'rxjs';
import { EMPTY } from 'rxjs';
import { ConfigService } from '../config/config.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { CircuitBreakerService } from './circuit-breaker.service';

@Injectable()
export class ProcessorService {
	private readonly PROCESSED_PAYMENTS_PREFIX = 'processed:payments';
	private readonly BATCH_SIZE = 25;
	private readonly BATCH_TIMEOUT = 1000;

	private processorPaymentUrl: {
		default: string;
		fallback: string;
	};

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
		this.processorPaymentUrl = {
			default: this.configService.getProcessorDefaultUrl() + '/payments',
			fallback: this.configService.getProcessorFallbackUrl() + '/payments',
		}
	}

	newPayment(paymentDto: PaymentDto) {
		const requestedAt = new Date().toISOString();

		const payment = {
			...paymentDto,
			requestedAt,
		};

		return payment;
	}

	processPayment(processorType: 'default' | 'fallback', data: PaymentDto): void {
		const payment = this.newPayment(data);

		this.httpService.post(this.processorPaymentUrl[processorType], payment)
			.pipe(
				catchError((error) => {
					if (error?.response?.status === HttpStatus.INTERNAL_SERVER_ERROR) {
						this.circuitBreakerService.reportProcessorFailure(processorType);
					}

					return EMPTY;
				}),
			)
			.subscribe({
				next: (response) => {
					if (response.status === HttpStatus.OK) {
						this.persistProcessedPaymentAsync(
							processorType,
							payment.amount,
							payment.requestedAt,
							payment.correlationId,
						);
					}
				},
				error: () => {
					return EMPTY;
				}
			});

		return;
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

			for (const payment of paymentsToProcess) {
				const timestamp = new Date(payment.requestedAt).getTime();
				const timelineKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${payment.processorType}:timeline`;
				const statsKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${payment.processorType}:stats`;

				pipeline.zadd(timelineKey, timestamp, `${payment.amount}:${payment.correlationId}`);

				pipeline.hincrby(statsKey, 'count', 1);
				pipeline.hincrbyfloat(statsKey, 'total', payment.amount);
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

			const [defaultRecords, fallbackRecords] = await Promise.all([
				this.getProcessedPaymentRecords('default', fromTime, toTime),
				this.getProcessedPaymentRecords('fallback', fromTime, toTime),
			]);

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

			let timelineData: string[];

			if (fromTime !== undefined || toTime !== undefined) {
				const min = fromTime ?? 0;
				const max = toTime ?? '+inf';

				timelineData = await Promise.race([
					this.redis.zrangebyscore(timelineKey, min, max, 'WITHSCORES'),
					new Promise<string[]>((_, reject) =>
						setTimeout(
							() => reject(new Error('Redis operation timeout')),
							10000,
						),
					),
				]);
			} else {
				timelineData = await Promise.race([
					this.redis.zrange(timelineKey, 0, -1, 'WITHSCORES'),
					new Promise<string[]>((_, reject) =>
						setTimeout(
							() => reject(new Error('Redis operation timeout')),
							10000,
						),
					),
				]);
			}

			if (timelineData.length === 0) {
				return [];
			}

			const records: any[] = [];
			for (let i = 0; i < timelineData.length; i += 2) {
				const memberData = timelineData[i].split(':');
				const amount = parseFloat(memberData[0]);
				const correlationId = memberData[1];
				const timestamp = parseInt(timelineData[i + 1], 10);

				records.push({
					amount,
					timestamp,
					requestedAt: new Date(timestamp).toISOString(),
					processorType,
					correlationId,
				});
			}

			return records;
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


			const [defaultStats, fallbackStats] = await Promise.all([
				this.getProcessedPaymentStats('default', fromTime, toTime),
				this.getProcessedPaymentStats('fallback', fromTime, toTime),
			]);

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
			const statsKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${processorType}:stats`;

			if (fromTime === undefined && toTime === undefined) {
				const [countStr, totalStr] = await Promise.race([
					this.redis.hmget(statsKey, 'count', 'total'),
					new Promise<string[]>((_, reject) =>
						setTimeout(
							() => reject(new Error('Redis operation timeout')),
							10000,
						),
					),
				]);

				return {
					totalRequests: parseInt(countStr || '0', 10),
					totalAmount: parseFloat(totalStr || '0'),
				};
			}

			const timelineKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${processorType}:timeline`;
			const min = fromTime ?? 0;
			const max = toTime ?? '+inf';

			const amounts = await Promise.race([
				this.redis.zrangebyscore(timelineKey, min, max),
				new Promise<string[]>((_, reject) =>
					setTimeout(
						() => reject(new Error('Redis operation timeout')),
						10000,
					),
				),
			]);

			if (amounts.length === 0) {
				return { totalRequests: 0, totalAmount: 0 };
			}

			const totalRequests = amounts.length;
			const totalAmount = amounts.reduce((sum, memberStr) => {
				const amount = parseFloat(memberStr.split(':')[0]);
				return sum + amount;
			}, 0);

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
