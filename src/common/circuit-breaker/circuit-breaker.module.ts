import { Module } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';
import { ConfigModule } from '../../config/config.module';
import { ConfigService } from '../../config/config.service';
import { Logger } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RedisModule } from '@nestjs-modules/ioredis';

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
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisConfig = configService.getRedisConfig();
        return {
          type: 'single',
          url: `redis://${redisConfig.host}:${redisConfig.port}`,
          keyPrefix: configService.getRedisKeyPrefix(),
          options: {
            maxRetriesPerRequest: 1,
            retryDelayOnFailover: 10,
            enableReadyCheck: false,
            maxLoadingTimeout: 1000,
            lazyConnect: true,
            family: 4,
            db: 0,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [CircuitBreakerService, Logger],
  exports: [CircuitBreakerService],
})
export class CircuitBreakerModule {}