import { Module } from '@nestjs/common';
import { PaymentModule } from './payment/payment.module';
import { ConfigModule } from './config/config.module';
import { SharedModule } from './common/shared.module';
import { PoolingModule } from './common/pooling/pooling.module';

@Module({
  imports: [
    ConfigModule,
    SharedModule,
    PaymentModule,
    PoolingModule,
  ],
})
export class AppModule {}
