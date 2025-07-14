import { Module, DynamicModule } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ProcessorService } from './processor.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { Logger } from '@nestjs/common';

@Module({})
export class ProcessorModule {
	static forProducer(): DynamicModule {
		return {
			module: ProcessorModule,
			imports: [
				HttpModule.register({
					timeout: 10000,
					maxRedirects: 5,
				}),
				ConfigModule,
				RedisModule.forRootAsync({
					imports: [ConfigModule],
					useFactory: (configService: ConfigService) => ({
						type: 'single',
						url: `redis://${configService.getRedisHost()}:${configService.getRedisPort()}`,
					}),
					inject: [ConfigService],
				}),
			],
			providers: [ProcessorService, Logger],
			exports: [ProcessorService],
		};
	}

	static forConsumer(): DynamicModule {
		return {
			module: ProcessorModule,
			imports: [
				HttpModule.register({
					timeout: 10000,
					maxRedirects: 5,
				}),
				ConfigModule,
				RedisModule.forRootAsync({
					imports: [ConfigModule],
					useFactory: (configService: ConfigService) => ({
						type: 'single',
						url: `redis://${configService.getRedisHost()}:${configService.getRedisPort()}`,
					}),
					inject: [ConfigService],
				}),
			],
			providers: [ProcessorService, CircuitBreakerService, Logger],
			exports: [ProcessorService, CircuitBreakerService],
		};
	}
}
