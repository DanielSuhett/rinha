import { Module } from '@nestjs/common';
import { PaymentModule } from './payment/payment.module';
import { ProcessorModule } from './processor/processor.module';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from './config/config.module';
import { ConfigService } from './config/config.service';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule,
    ProcessorModule,
    PaymentModule,
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
    HttpModule.register({
      timeout: 5000,
    }),
    ScheduleModule.forRoot(),
  ],
})
export class AppModule { }
