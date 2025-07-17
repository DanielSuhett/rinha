import { JOB_REF, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject } from '@nestjs/common';
import { PaymentDto } from './payment.dto';
import {
	CircuitBreakerService,
	CircuitBreakerColor,
} from '../common/circuit-breaker';
import { ProcessorService } from '../processor/processor.service';

export enum PaymentProcessor {
	DEFAULT = 'default',
	FALLBACK = 'fallback',
}
@Processor({
	name: 'payment',
}, {
	autorun: process.env.APP_MODE === 'CONSUMER',
})
export class PaymentConsumer extends WorkerHost {
	constructor(
		private readonly processorService: ProcessorService,
		private readonly circuitBreakerService: CircuitBreakerService,
		@Inject(JOB_REF) private job: Job<PaymentDto>,
	) {
		super();
	}

	async process() {
		const currentColor = this.circuitBreakerService.getCurrentColor();

		if (currentColor === CircuitBreakerColor.RED) {
			return Promise.reject(new Error('Circuit breaker: ' + currentColor));
		}

		if (currentColor === CircuitBreakerColor.GREEN) {
			return this.processorService.processPayment(PaymentProcessor.DEFAULT, this.job.data);
		}

		if (currentColor === CircuitBreakerColor.YELLOW) {
			return this.processorService.processPayment(PaymentProcessor.FALLBACK, this.job.data);
		}
	}
}
