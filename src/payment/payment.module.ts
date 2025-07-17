import { Module, DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PaymentController } from './payment.controller';
import { PaymentConsumer } from './payment.processor';
import { ProcessorModule } from '../processor/processor.module';
import { CircuitBreakerModule } from '../common/circuit-breaker';
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
				ProcessorModule.forProducer(),
				CircuitBreakerModule.forProducer(),
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
				ProcessorModule.forConsumer(),
				CircuitBreakerModule.forConsumer(),
			],
			providers: [PaymentConsumer],
		};
	}
}
