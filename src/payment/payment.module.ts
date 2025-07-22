import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { CircuitBreakerModule } from '../common/circuit-breaker';
import { ConfigModule } from '../config/config.module';
import { InMemoryQueueModule } from '../common/in-memory-queue/in-memory-queue.module';
import { PaymentService } from './payment.service';
import { PaymentRepository } from './payment.repository';
import { HttpModule } from '@nestjs/axios';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ConfigService } from '../config/config.service';

@Module({
	imports: [
		ConfigModule,
		CircuitBreakerModule,
		InMemoryQueueModule,
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
	controllers: [PaymentController],
	providers: [PaymentService, PaymentRepository],
	exports: [PaymentService],
})
export class PaymentModule {}