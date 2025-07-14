import { Module, DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { PaymentController } from './payment.controller';
import { PaymentConsumer } from './payment.processor';
import { ProcessorModule } from '../processor/processor.module';
import { ConfigModule } from '../config/config.module';

@Module({})
export class PaymentModule {
	static forProducer(): DynamicModule {
		return {
			module: PaymentModule,
			imports: [
				BullModule.registerQueue({
					name: 'payment',
				}),
				ConfigModule,
				HttpModule.register({
					timeout: 10000,
					maxRedirects: 5,
				}),
				ProcessorModule.forProducer(),
			],
			controllers: [PaymentController],
		};
	}

	static forConsumer(): DynamicModule {
		return {
			module: PaymentModule,
			imports: [
				BullModule.registerQueue({
					name: 'payment',
				}),
				ConfigModule,
				HttpModule.register({
					timeout: 10000,
					maxRedirects: 5,
				}),
				ProcessorModule.forConsumer(),
			],
			providers: [PaymentConsumer],
		};
	}
}
