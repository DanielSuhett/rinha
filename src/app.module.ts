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
      PaymentModule.forRoot(),
    ];



    return {
      module: AppModule,
      imports: modules,
    };
  }
}
