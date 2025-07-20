import { Module, DynamicModule } from '@nestjs/common';
import { ProcessorService } from './processor.service';
import { ConfigModule } from '../config/config.module';
import { Logger } from '@nestjs/common';
import { CircuitBreakerModule } from 'src/common/circuit-breaker/circuit-breaker.module';
import { CircuitBreakerService } from 'src/common';
import { InMemoryQueueModule } from '../common/in-memory-queue/in-memory-queue.module';

@Module({})
export class ProcessorModule {
  static forRoot(): DynamicModule {
    return {
      module: ProcessorModule,
      imports: [ConfigModule, CircuitBreakerModule, InMemoryQueueModule],
      providers: [ProcessorService, CircuitBreakerService, Logger],
      exports: [ProcessorService],
    };
  }
}
