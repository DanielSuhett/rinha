import { Module } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';
import { ConfigModule } from '../../config/config.module';
import { Logger } from '@nestjs/common';
import { HttpClientModule } from '../http/http-client.module';

@Module({
  imports: [
    ConfigModule,
    HttpClientModule,
  ],
  providers: [CircuitBreakerService, Logger],
  exports: [CircuitBreakerService],
})
export class CircuitBreakerModule { }
