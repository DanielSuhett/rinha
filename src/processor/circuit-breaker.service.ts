import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '../config/config.service';
import { lastValueFrom } from 'rxjs';

export enum CircuitBreakerColor {
	GREEN = 'green',
	YELLOW = 'yellow',
	RED = 'red',
}

export interface ProcessorHealth {
	failing: boolean;
	minResponseTime: number;
}

@Injectable()
export class CircuitBreakerService {
	private readonly logger = new Logger(CircuitBreakerService.name);
	private currentColor: CircuitBreakerColor = CircuitBreakerColor.GREEN;
	private processor: {
		default: string;
		fallback: string;
	};
	private paymentHealth: ProcessorHealth = {
		failing: false,
		minResponseTime: 0,
	};
	private fallbackHealth: ProcessorHealth = {
		failing: false,
		minResponseTime: 0,
	};

	constructor(
		private readonly httpService: HttpService,
		private readonly configService: ConfigService,
	) {
		this.processor = {
			default: `${this.configService.getProcessorDefaultUrl()}/payments/service-health`,
			fallback: `${this.configService.getProcessorFallbackUrl()}/payments/service-health`,
		}
	}



	@Cron('*/5 * * * * *', {
		disabled: process.env.APP_MODE === 'PRODUCER',
	})
	async checkHealth(): Promise<void> {
		try {

			const defaultResponse = await lastValueFrom(this.httpService.get(this.processor.default)).catch((error) => {
				if (error?.response?.status === 429) {
					return;
				}
				return { data: { minResponseTime: 0, failing: true } };
			});

			const fallbackResponse = await lastValueFrom(this.httpService.get(this.processor.fallback)).catch((error) => {
				if (error?.response?.status === 429) {
					return;
				}
				return { data: { minResponseTime: 0, failing: true } };
			});

			if (!defaultResponse || !fallbackResponse) {
				return;
			}

			this.paymentHealth = defaultResponse?.data || { minResponseTime: 0, failing: true };
			this.fallbackHealth = fallbackResponse?.data || { minResponseTime: 0, failing: true };

			this.updateCircuitBreakerColor();

			if (this.currentColor !== CircuitBreakerColor.GREEN) {
				this.logger.warn(`Circuit breaker status: ${this.currentColor}`);
			}
		} catch (error) {
			this.logger.error('Error during health check');
		}
	}

	private updateCircuitBreakerColor(): void {
		const { failing: paymentFailing, minResponseTime: paymentResponseTime } =
			this.paymentHealth;
		const { failing: fallbackFailing, minResponseTime: fallbackResponseTime } =
			this.fallbackHealth;

		const everythingUp = !paymentFailing && !fallbackFailing;

		if (paymentFailing && fallbackFailing) {
			this.currentColor = CircuitBreakerColor.RED;
			return;
		}

		if (
			everythingUp &&
			paymentResponseTime > 5000 &&
			fallbackResponseTime < 5000
		) {
			this.currentColor = CircuitBreakerColor.YELLOW;
			return;
		}

		if (paymentFailing && !fallbackFailing) {
			this.currentColor = CircuitBreakerColor.YELLOW;
			return;
		}

		this.currentColor = CircuitBreakerColor.GREEN;
	}

	getCurrentColor(): CircuitBreakerColor {
		return this.currentColor;
	}

	getHealthStatus() {
		return {
			color: this.currentColor,
			payment: this.paymentHealth,
			fallback: this.fallbackHealth,
		};
	}

	reportProcessorFailure(processorType: 'default' | 'fallback'): void {
		const timestamp = Date.now();

		if (processorType === 'default') {
			this.paymentHealth = { failing: true, minResponseTime: 0 };
			this.logger.warn(`Default processor marked as failing due to 500 error at ${new Date(timestamp).toISOString()}`);
		} else {
			this.fallbackHealth = { failing: true, minResponseTime: 0 };
			this.logger.warn(`Fallback processor marked as failing due to 500 error at ${new Date(timestamp).toISOString()}`);
		}

		this.updateCircuitBreakerColor();

		if (this.currentColor !== CircuitBreakerColor.GREEN) {
			this.logger.warn(`Circuit breaker status updated to: ${this.currentColor}`);
		}
	}
}
