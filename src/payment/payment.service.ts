import { Injectable } from '@nestjs/common';
import { PaymentDto } from './payment.dto';
import { ProcessorService } from '../processor/processor.service';

@Injectable()
export class PaymentService {
	constructor(private readonly processorService: ProcessorService) {}

	async processPayment(paymentDto: PaymentDto): Promise<string> {
		try {
			return await this.processorService.processPayment(paymentDto);
		} catch (error) {
			console.error('Default processor failed, trying fallback:', error);
			return await this.processorService.processFallbackPayment(paymentDto);
		}
	}
}
