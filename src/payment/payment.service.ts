import { Injectable } from '@nestjs/common';
import { PaymentDto } from './payment.dto';
import { ProcessorService } from '../processor/processor.service';

@Injectable()
export class PaymentService {
	constructor(private readonly processorService: ProcessorService) {}

	async processPayment(paymentDto: PaymentDto): Promise<string> {
		return await this.processorService.processPayment(paymentDto);
	}

	async processFallbackPayment(paymentDto: PaymentDto): Promise<string> {
		return await this.processorService.processFallbackPayment(paymentDto);
	}
}
