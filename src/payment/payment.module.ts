import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PaymentConsumer } from './payment.processor';
import { ProcessorService } from '../processor/processor.service';

@Module({
	imports: [
		BullModule.registerQueue({
			name: 'payment',
		}),
		ConfigModule.forRoot({
			envFilePath: '.env',
		}),
		HttpModule.register({
			timeout: 5000,
			maxRedirects: 5,
		}),
	],
	providers: [PaymentService, PaymentConsumer, ProcessorService],
	controllers: [PaymentController],
})
export class PaymentModule {}
