import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PaymentDto, Processor } from '../payment/payment.dto';
import { HttpService } from '@nestjs/axios';
import { catchError } from 'rxjs';
import { EMPTY } from 'rxjs';
import { ConfigService } from '../config/config.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { CircuitBreakerColor, CircuitBreakerService } from 'src/common/circuit-breaker/circuit-breaker.service';
import { InMemoryQueueService } from '../common/in-memory-queue/in-memory-queue.service';

@Injectable()
export class PaymentRepository implements OnModuleInit {
  private readonly PROCESSED_PAYMENTS_PREFIX = 'processed:payments';

  private processorPaymentUrl: {
    default: string;
    fallback: string;
  };

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly inMemoryQueueService: InMemoryQueueService<PaymentDto>,
  ) { }

  onModuleInit() {
    const processorUrls = this.configService.getProcessorUrls();
    this.processorPaymentUrl = {
      default: `${processorUrls.default}/payments`,
      fallback: `${processorUrls.fallback}/payments`,
    };
  }

  newPayment(stringifiedData: string) {
    const requestedAt = new Date().toISOString();
    const paymentWithDate = stringifiedData.slice(0, -1) + `,"requestedAt":"${requestedAt}"}`;
    return paymentWithDate
  }

    newPaymentJSON(stringifiedData: string) {
    const requestedAt = new Date().toISOString();
    // const paymentWithDate = stringifiedData.slice(0, -1) + `,"requestedAt":"${requestedAt}"}`;
    const payment = JSON.parse(stringifiedData);
    return {
      ...payment,
      requestedAt
    }
  }

  private async save(
    processorType: Processor,
    amount: number,
    correlationId: string,
    requestedAt: string,
  ): Promise<void> {
    const timestamp = new Date(requestedAt).getTime();
    const pipeline = this.redis.pipeline();

    const timelineKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${processorType}:timeline`;
    const statsKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${processorType}:stats`;

    pipeline.zadd(timelineKey, 'NX', timestamp, `${amount}:${correlationId}`);
    pipeline.hincrby(statsKey, 'count', 1);
    pipeline.hincrbyfloat(statsKey, 'total', amount);

    await pipeline.exec();
  }

  public send(processorType: Processor, data: string): void {
    const payment = this.newPaymentJSON(data);
    this.httpService.post(this.processorPaymentUrl[processorType], payment, {
      timeout: 3000,
    })
      .pipe(
        catchError((_) => {
          this.circuitBreakerService.signal(processorType)
            .then((color) => {
              if (!color) {
                return EMPTY;
              }

              if (color === CircuitBreakerColor.RED) {
                this.inMemoryQueueService.requeue(data)
                return EMPTY;
              }

              this.send(processorType, data);
            })

          return EMPTY;
        }),
      )
      .subscribe({
        next: (response) => {
          if (response.status === HttpStatus.OK || response.status === HttpStatus.CREATED) {
            const { amount, correlationId, requestedAt } = payment;
            this.save(
              processorType,
              amount,
              correlationId,
              requestedAt
            ).catch(e => console.error(e));
          }
        },
        error: (_) => {
          return EMPTY;
        }
      });

    return;
  }

  public async find(
    processorType: Processor,
    fromTime?: number,
    toTime?: number,
  ): Promise<{ totalRequests: number; totalAmount: number }> {
    try {
      const statsKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${processorType}:stats`;

      if (fromTime === undefined && toTime === undefined) {
        const [countStr, totalStr] = await Promise.race([
          this.redis.hmget(statsKey, 'count', 'total'),
          new Promise<string[]>((_, reject) =>
            setTimeout(
              () => reject(new Error('Redis operation timeout')),
              10000,
            ),
          ),
        ]);

        return {
          totalRequests: parseInt(countStr || '0', 10),
          totalAmount: Math.round(parseFloat(totalStr || '0') * 100) / 100,
        };
      }

      const timelineKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${processorType}:timeline`;
      const min = fromTime ?? 0;
      const max = toTime ?? '+inf';

      const amounts = await Promise.race([
        this.redis.zrangebyscore(timelineKey, min, max),
        new Promise<string[]>((_, reject) =>
          setTimeout(
            () => reject(new Error('Redis operation timeout')),
            10000,
          ),
        ),
      ]);

      if (amounts.length === 0) {
        return { totalRequests: 0, totalAmount: 0 };
      }

      const totalRequests = amounts.length;
      const totalAmount = amounts.reduce((sum, memberStr) => {
        const amount = parseFloat(memberStr.split(':')[0]);
        return sum + amount;
      }, 0);

      return {
        totalRequests,
        totalAmount: Math.round(totalAmount * 100) / 100,
      };
    } catch (error) {
      return { totalRequests: 0, totalAmount: 0 };
    }
  }
}
