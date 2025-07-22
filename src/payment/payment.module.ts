import { Module } from '@nestjs/common';
import { CircuitBreakerModule } from '../common/circuit-breaker';
import { ConfigModule } from '../config/config.module';
import { InMemoryQueueModule } from '../common/in-memory-queue/in-memory-queue.module';
import { PaymentService } from './payment.service';
import { PaymentRepository } from './payment.repository';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ConfigService } from '../config/config.service';
import { HttpClientModule } from '../common/http/http-client.module';

@Module({
	imports: [
		ConfigModule,
		CircuitBreakerModule,
		InMemoryQueueModule,
		HttpClientModule,
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
	controllers: [],
	providers: [PaymentService, PaymentRepository],
	exports: [PaymentService],
})
export class PaymentModule {}