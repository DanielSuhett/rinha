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
  private backoffDelay = 100;
  private readonly MIN_BACKOFF = 100;
  private readonly MAX_BACKOFF = 1000;
  private readonly BACKOFF_MULTIPLIER = 1.1;

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
        const batch = await this.redis.lpop(this.queueKey, 10);

        if (batch?.length) {
          this.backoffDelay = this.MIN_BACKOFF;
          await Promise.all(batch.map(item => this.paymentService.processPayment(item)));
        } else {
          await this.exponentialBackoff();
        }
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, this.pollingInterval));
      }
    }
  }

  private async exponentialBackoff(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.backoffDelay));

    this.backoffDelay = Math.min(
      this.backoffDelay * this.BACKOFF_MULTIPLIER,
      this.MAX_BACKOFF
    );
  }
}
