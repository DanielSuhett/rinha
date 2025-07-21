import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PaymentDto } from './payment.dto';
import { PaymentService } from './payment.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';

@Injectable()
export class PaymentProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly queueKey: string = process.env.APP_MODE || 'queue_payment';
  private isProcessing: boolean = false;
  private readonly pollingIntervalMs = 100;
  private readonly logger = new Logger(PaymentProcessor.name);

  constructor(
    private readonly paymentService: PaymentService,
    @InjectRedis() private readonly redis: Redis,
  ) { }

  onModuleInit() {
    this.isProcessing = true;
    this.startProcessing();
  }

  onModuleDestroy() {
    this.isProcessing = false;
  }

  private async startProcessing() {
    if (!this.isProcessing) {
      return;
    }

    try {
      const serializedPayment = await this.redis.lpop(this.queueKey);

      if (serializedPayment) {
        const payment: PaymentDto = JSON.parse(serializedPayment);
        this.paymentService.processPayment(payment);
        setImmediate(() => this.startProcessing());
      } else {
        setImmediate(() => this.startProcessing());
      }
    } catch (error) {
      this.logger.error(`Error processing payment from queue: ${error.message}`);
      setTimeout(() => this.startProcessing(), this.pollingIntervalMs);
    }
  }
}
