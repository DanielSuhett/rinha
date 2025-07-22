import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { ConfigService } from '../../config/config.service';
import { InMemoryPooling } from './pooling.service';
import { PaymentModule } from '../../payment/payment.module';
import { RedisModule } from '@nestjs-modules/ioredis';

@Module({
  imports: [
    ConfigModule,
    PaymentModule,
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
  providers: [InMemoryPooling],
})
export class PoolingModule {}