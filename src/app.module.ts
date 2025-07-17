import { Module, DynamicModule } from '@nestjs/common';
import { PaymentModule } from './payment/payment.module';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';
import { SharedModule } from './common/shared.module';

@Module({})
export class AppModule {
	static forRoot(): DynamicModule {
		const appMode = process.env.APP_MODE || 'PRODUCER';

		const commonModules = [
			ConfigModule,
			SharedModule.forRoot(),
			BullModule.forRootAsync({
				imports: [ConfigModule],
				inject: [ConfigService],
				useFactory: (configService: ConfigService) => ({
					connection: {
						host: configService.getRedisHost(),
						port: configService.getRedisPort(),
					},
				}),
			}),
			HealthModule,
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
