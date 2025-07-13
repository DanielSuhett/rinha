import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ProcessorService } from './processor.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { ProcessorController } from './processor.controller';

@Module({
  imports: [
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5,
    }),
  ],
  providers: [ProcessorService, CircuitBreakerService],
  controllers: [ProcessorController],
  exports: [ProcessorService, CircuitBreakerService],
})
export class ProcessorModule {}
