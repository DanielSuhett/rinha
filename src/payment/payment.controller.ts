import { Body, Controller, Post } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { PaymentDto } from './payment.dto';
import { Queue } from 'bullmq';

@Controller('payments')
export class PaymentController {
	constructor(
		@InjectQueue('payment') private readonly paymentQueue: Queue<PaymentDto, string>,
	) {}

	@Post()
	createPayment(@Body() payment: PaymentDto) {
		this.paymentQueue.add('payment', payment).catch((err) => {
			throw new Error(err ?? 'Error adding payment to queue');
		});
		return { message: 'Payment created' };
	}
}
