import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PaymentDto } from './payment.dto';
import {
	CircuitBreakerService,
	CircuitBreakerColor,
} from '../processor/circuit-breaker.service';
import { ProcessorService } from '../processor/processor.service';

export enum PaymentProcessor {
	DEFAULT = 'default',
	FALLBACK = 'fallback',
}

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

	process(job: Job<PaymentDto>): Promise<void> {
		const currentColor = this.circuitBreakerService.getCurrentColor();

		if (currentColor === CircuitBreakerColor.RED) {
			return Promise.reject(new Error(CircuitBreakerColor.RED));
		}

		if (currentColor === CircuitBreakerColor.GREEN) {
			this.processorService.processPayment(PaymentProcessor.DEFAULT, job.data);
			return Promise.resolve();
		}

		if (currentColor === CircuitBreakerColor.YELLOW) {
			this.processorService.processPayment(PaymentProcessor.FALLBACK, job.data);
			return Promise.resolve();
		}

		throw new Error(`Unknown circuit breaker color`);
	}
}
