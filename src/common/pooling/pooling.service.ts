import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { PaymentService } from '../../payment/payment.service';
import { ConfigService } from 'src/config/config.service';


@Injectable()
export class InMemoryPooling implements OnModuleInit, OnModuleDestroy {
  private readonly queueKey: string;
  private readonly pollingInterval: number;
  private isProcessing: boolean;

  constructor(
    private readonly paymentService: PaymentService,
    @InjectRedis() private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.queueKey = this.configService.getRedisKeyPrefix()
    this.pollingInterval = this.configService.getConstraints().pollingInterval
  }


  onModuleInit() {
    this.isProcessing = true;
    this.startProcessing();
  }

  onModuleDestroy() {
    this.isProcessing = false;
  }

  private async startProcessing() {
    while (this.isProcessing) {
      try {
        const result = await this.redis.blpop(this.queueKey, 1);

        if (result) {
          const [, payment] = result;
          setImmediate(() => this.paymentService.processPayment(payment));
        }
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, this.pollingInterval));
      }
    }
  }
}
