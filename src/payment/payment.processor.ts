import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PaymentDto } from './payment.dto';
import { PaymentService } from './payment.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';

@Injectable()
export class PaymentProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly queueKey: string = process.env.APP_MODE || 'queue_payment'; // Must match the key in InMemoryQueueService
  private isProcessing: boolean = false;
  private readonly pollingIntervalMs = 100;
  private processingTimeout: NodeJS.Timeout | null = null;
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
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
    }
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
        this.processingTimeout = setTimeout(() => this.startProcessing(), 0);
      } else {
        this.processingTimeout = setTimeout(() => this.startProcessing(), this.pollingIntervalMs);
      }
    } catch (error) {
      this.logger.error(`Error processing payment from queue: ${error.message}`);
      this.processingTimeout = setTimeout(() => this.startProcessing(), this.pollingIntervalMs + 1000);
    }
  }
}
