import { Injectable } from '@nestjs/common';
import { PaymentSummaryResponseDto } from './payment.dto';
import { ProcessorService } from '../processor/processor.service';

@Injectable()
export class PaymentService {
	constructor(private readonly processorService?: ProcessorService) {}

	async getPaymentSummary(
		from?: string,
		to?: string,
	): Promise<PaymentSummaryResponseDto> {
		if (!this.processorService) {
			throw new Error('ProcessorService not available in producer mode');
		}
		return await this.processorService.getPaymentSummary(from, to);
	}
}
