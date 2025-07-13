import { PaymentService } from './payment.service';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { PaymentDto } from './payment.dto';

@Injectable()
@Processor('payment')
export class PaymentConsumer extends WorkerHost {
	constructor(private readonly paymentService: PaymentService) {
		super();
	}

	async process(job: Job<PaymentDto>): Promise<string> {
		const result = await this.paymentService.processPayment(job.data);
		console.log('Payment processed:', job.data);
		return result;
	}
}
