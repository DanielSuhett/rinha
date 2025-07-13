import { Module } from '@nestjs/common';
import { PaymentModule } from './payment/payment.module';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';

@Module({
	imports: [
		ConfigModule,
		PaymentModule,
		BullModule.forRootAsync({
			useFactory: (configService: ConfigService) => ({
				connection: {
					host: configService.getRedisHost(),
					port: configService.getRedisPort(),
				},
			}),
			inject: [ConfigService],
		}),
		HttpModule.register({
			timeout: 5000,
		}),
	],
})
export class AppModule {}
