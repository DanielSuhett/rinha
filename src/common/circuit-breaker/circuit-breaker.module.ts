import { Module } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';
import { CircuitBreakerManager } from './circuit-breaker.manager';
import { CircuitBreakerSyncService } from './circuit-breaker-sync.service';
import { ConfigModule } from '../../config/config.module';
import { Logger } from '@nestjs/common';

@Module({
  imports: [
    ConfigModule,
  ],
  providers: [CircuitBreakerService, CircuitBreakerManager, CircuitBreakerSyncService, Logger],
  exports: [CircuitBreakerService],
})
export class CircuitBreakerModule { }
