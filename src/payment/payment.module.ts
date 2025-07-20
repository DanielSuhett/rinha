import { Module, DynamicModule } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { ProcessorModule } from '../processor/processor.module';
import { CircuitBreakerModule } from '../common/circuit-breaker';
import { ConfigModule } from '../config/config.module';
import { InMemoryQueueModule } from '../common/in-memory-queue/in-memory-queue.module';
import { PaymentService } from './payment.service';
import { PaymentProcessor } from './payment.processor';

@Module({})
export class PaymentModule {
	static forRoot(): DynamicModule {
		return {
			module: PaymentModule,
			imports: [
				ConfigModule,
				ProcessorModule.forRoot(),
				CircuitBreakerModule.forRoot(),
				InMemoryQueueModule,
			],
			controllers: [PaymentController],
			providers: [PaymentService, PaymentProcessor],
		};
	}
}