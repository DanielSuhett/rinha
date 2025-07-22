import { Module } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';
import { ConfigModule } from '../../config/config.module';
import { ConfigService } from '../../config/config.service';
import { Logger } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    ConfigModule,
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: () => ({
        timeout: 10000,
      }),
    }),
  ],
  providers: [CircuitBreakerService, Logger],
  exports: [CircuitBreakerService],
})
export class CircuitBreakerModule { }
