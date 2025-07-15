import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PaymentDto } from './payment.dto';
import {
	CircuitBreakerService,
	CircuitBreakerColor,
} from '../processor/circuit-breaker.service';
import { ProcessorService } from '../processor/processor.service';

@Injectable()
@Processor('payment')
export class PaymentConsumer extends WorkerHost {
	private readonly logger = new Logger(PaymentConsumer.name);

	constructor(
		private readonly processorService: ProcessorService,
		private readonly circuitBreakerService: CircuitBreakerService,
	) {
		super();
	}

	async process(job: Job<PaymentDto>): Promise<string | void> {
		const currentColor = this.circuitBreakerService.getCurrentColor();

		if (currentColor === CircuitBreakerColor.RED) {
			throw new Error('CIRCUIT_BREAKER_RED');
		}

		try {
			let result: string;

			if (currentColor === CircuitBreakerColor.GREEN) {
				result = await this.processorService.processPayment(job.data);
			} else if (currentColor === CircuitBreakerColor.YELLOW) {
				result = await this.processorService.processFallbackPayment(job.data);
			} else {
				throw new Error(`Unknown circuit breaker color`);
			}

			return result;
		} catch (error) {
			const errorMessage = this.extractErrorMessage(error);
			this.logger.error(
				`Payment processing failed (${currentColor}): ${job.data.correlationId} - ${errorMessage}`,
			);
			throw error;
		}
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
}
