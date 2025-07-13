import { Injectable } from '@nestjs/common';
import { PaymentDto } from '../payment/payment.dto';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { ConfigService } from '../config/config.service';

@Injectable()
export class ProcessorService {
	private readonly defaultProcessorUrl: string;
	private readonly fallbackProcessorUrl: string;

	constructor(
		private readonly httpService: HttpService,
		private readonly configService: ConfigService,
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
			await lastValueFrom(
				this.httpService.post(`${this.defaultProcessorUrl}/payments`, payment),
			);
		} catch (error) {
			console.error('Error processing payment with default processor:', error);
			throw error;
		}

		return 'Payment processed!';
	}

	async processFallbackPayment(data: PaymentDto): Promise<string> {
		const payment = this.newPayment(data);

		try {
			await lastValueFrom(
				this.httpService.post(`${this.fallbackProcessorUrl}/payments`, payment),
			);
		} catch (error) {
			console.error('Error processing payment with fallback processor:', error);
			throw error;
		}

		return 'Payment fallback processed!';
	}
}
