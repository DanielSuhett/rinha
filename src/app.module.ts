import { Module, DynamicModule } from '@nestjs/common';
import { PaymentModule } from './payment/payment.module';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { HealthModule } from './health/health.module';
import { SharedModule } from './common/shared.module';

@Module({})
export class AppModule {
	static forRoot(): DynamicModule {
		const modules = [
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
			PaymentModule.forRoot(),
		];



		return {
			module: AppModule,
			imports: modules,
		};
	}
}
