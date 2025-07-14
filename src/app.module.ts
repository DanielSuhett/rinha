import { Module, DynamicModule } from '@nestjs/common';
import { PaymentModule } from './payment/payment.module';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';

@Module({})
export class AppModule {
	static forRoot(): DynamicModule {
		const configService = new ConfigService();
		const appMode = configService.getAppMode();

		const commonModules = [
			ConfigModule,
			HealthModule,
			BullModule.forRootAsync({
				useFactory: (configService: ConfigService) => ({
					connection: {
						host: configService.getRedisHost(),
						port: configService.getRedisPort(),
					},
				}),
				inject: [ConfigService],
			}),
			HttpModule.register({}),
		];

		const modules = [...commonModules];

		if (appMode === 'PRODUCER') {
			modules.push(PaymentModule.forProducer());
		} else if (appMode === 'CONSUMER') {
			modules.push(
				PaymentModule.forConsumer(),
				ScheduleModule.forRoot(),
			);
		}

		return {
			module: AppModule,
			imports: modules,
		};
	}
}
