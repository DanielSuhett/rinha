import { Module, DynamicModule } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';
import { ConfigModule } from '../../config/config.module';
import { Logger } from '@nestjs/common';

@Module({})
export class CircuitBreakerModule {
  static forProducer(): DynamicModule {
    return {
      module: CircuitBreakerModule,
      imports: [ConfigModule],
      providers: [CircuitBreakerService, Logger],
      exports: [CircuitBreakerService],
    };
  }

  static forConsumer(): DynamicModule {
    return {
      module: CircuitBreakerModule,
      imports: [ConfigModule],
      providers: [CircuitBreakerService, Logger],
      exports: [CircuitBreakerService],
    };
  }
}