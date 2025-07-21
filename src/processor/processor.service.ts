import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PaymentDto } from '../payment/payment.dto';
import { HttpService } from '@nestjs/axios';
import { catchError } from 'rxjs';
import { EMPTY } from 'rxjs';
import { ConfigService } from '../config/config.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { CircuitBreakerColor, CircuitBreakerService } from 'src/common/circuit-breaker/circuit-breaker.service';
import { InMemoryQueueService } from '../common/in-memory-queue/in-memory-queue.service';

@Injectable()
export class ProcessorService implements OnModuleInit {
  private readonly PROCESSED_PAYMENTS_PREFIX = 'processed:payments';

  private processorPaymentUrl: {
    default: string;
    fallback: string;
  };

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
    private readonly logger: Logger,
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

  newPayment(paymentDto: PaymentDto) {
    const requestedAt = new Date().toISOString();

    const payment = {
      ...paymentDto,
      requestedAt,
    };

    return payment;
  }

  private retryAfterSignal(processorType: 'default' | 'fallback', data: PaymentDto): void {
    const payment = this.newPayment(data);
    this.httpService.post(this.processorPaymentUrl[processorType], payment, {
      headers: { 'Connection': 'keep-alive' },
      timeout: 3000,
    })
      .pipe(
        catchError((error) => {
          this.requeuePayment(data)
          return EMPTY;
        })
      )
      .subscribe({
        next: (response) => {
          if (response.status === HttpStatus.OK || response.status === HttpStatus.CREATED) {
            this.logger.debug('recovered from signal');
            this.persistProcessedPayment(processorType, payment.amount, payment.correlationId, payment.requestedAt)
              .catch(e => this.logger.error(`Failed to persist: ${e.message}`));
          }
        },
        error: () => {
          this.logger.error(`error to signal: ${processorType} error`);
          this.requeuePayment(data)
        }
      });
  }

  private requeuePayment(data: PaymentDto): void {
    return this.inMemoryQueueService.requeue(data);
  }

  public sendPaymentToProcessor(processorType: 'default' | 'fallback', data: PaymentDto): void {
    const payment = this.newPayment(data);

    this.httpService.post(this.processorPaymentUrl[processorType], payment, {
      timeout: 3000,
    })
      .pipe(
        catchError((error) => {
          this.circuitBreakerService.signal(processorType)
            .then((color) => {
              if (!color) {
                this.logger.error(`loss processor: ${processorType}`);
                return EMPTY;
              }

              if (color === CircuitBreakerColor.RED) {
                this.requeuePayment(data)
                return EMPTY;
              }

              this.retryAfterSignal(processorType, data);
            })

          return EMPTY;
        }),
      )
      .subscribe({
        next: (response) => {
          if (response.status === HttpStatus.OK || response.status === HttpStatus.CREATED) {
            this.persistProcessedPayment(
              processorType,
              payment.amount,
              payment.correlationId,
              payment.requestedAt
            ).catch(e => this.logger.error(`Failed to persist: ${e.message}`));
          }
        },
        error: () => {
          this.logger.error(`error to store: ${processorType} error`);
          return EMPTY;
        }
      });

    return;
  }

  private extractErrorMessage(error: any): string {
    if (error?.response) {
      return `HTTP ${error.response.status} - ${error.response.statusText || 'Unknown'} (${error.config?.url || 'unknown URL'})`;
    }
    if (error?.code) {
      return `${error.code}: ${error.message}`;
    }
    return error?.message || 'Unknown error';
  }

  private async persistProcessedPayment(
    processorType: 'default' | 'fallback',
    amount: number,
    correlationId: string,
    requestedAt: string,
  ): Promise<void> {
    const timestamp = new Date(requestedAt).getTime();
    const pipeline = this.redis.pipeline();

    const timelineKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${processorType}:timeline`;
    const statsKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${processorType}:stats`;

    // Atomic operations - all succeed or all fail
    pipeline.zadd(timelineKey, 'NX', timestamp, `${amount}:${correlationId}`);
    pipeline.hincrby(statsKey, 'count', 1);
    pipeline.hincrbyfloat(statsKey, 'total', amount);

    await pipeline.exec();
  }


  async getPaymentRecords(
    from?: string,
    to?: string,
  ): Promise<{
    default: any[];
    fallback: any[];
  }> {
    try {
      const fromDate = from ? new Date(from) : undefined;
      const toDate = to ? new Date(to) : undefined;

      const fromTime = fromDate?.getTime() ?? undefined;
      const toTime = toDate?.getTime() ?? undefined;

      const [defaultRecords, fallbackRecords] = await Promise.all([
        this.getProcessedPaymentRecords('default', fromTime, toTime),
        this.getProcessedPaymentRecords('fallback', fromTime, toTime),
      ]);

      return {
        default: defaultRecords,
        fallback: fallbackRecords,
      };
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.logger.error(`Error in getPaymentRecords: ${errorMessage}`);
      throw error;
    }
  }

  private async getProcessedPaymentRecords(
    processorType: 'default' | 'fallback',
    fromTime?: number,
    toTime?: number,
  ): Promise<any[]> {
    try {
      const timelineKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${processorType}:timeline`;

      let timelineData: string[];

      if (fromTime !== undefined || toTime !== undefined) {
        const min = fromTime ?? 0;
        const max = toTime ?? '+inf';

        timelineData = await Promise.race([
          this.redis.zrangebyscore(timelineKey, min, max, 'WITHSCORES'),
          new Promise<string[]>((_, reject) =>
            setTimeout(
              () => reject(new Error('Redis operation timeout')),
              10000,
            ),
          ),
        ]);
      } else {
        timelineData = await Promise.race([
          this.redis.zrange(timelineKey, 0, -1, 'WITHSCORES'),
          new Promise<string[]>((_, reject) =>
            setTimeout(
              () => reject(new Error('Redis operation timeout')),
              10000,
            ),
          ),
        ]);
      }

      if (timelineData.length === 0) {
        return [];
      }

      const records: any[] = [];
      for (let i = 0; i < timelineData.length; i += 2) {
        const memberData = timelineData[i].split(':');
        const amount = parseFloat(memberData[0]);
        const correlationId = memberData[1];
        const timestamp = parseInt(timelineData[i + 1], 10);

        records.push({
          amount,
          timestamp,
          requestedAt: new Date(timestamp).toISOString(),
          processorType,
          correlationId,
        });
      }

      return records;
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.logger.error(
        `Error getting processor records for ${processorType}: ${errorMessage}`,
      );
      return [];
    }
  }

  async getPaymentSummary(
    from?: string,
    to?: string,
  ): Promise<{
    default: { totalRequests: number; totalAmount: number };
    fallback: { totalRequests: number; totalAmount: number };
  }> {
    try {
      const fromDate = from ? new Date(from) : undefined;
      const toDate = to ? new Date(to) : undefined;

      const fromTime = fromDate?.getTime() ?? undefined;
      const toTime = toDate?.getTime() ?? undefined;


      const [defaultStats, fallbackStats] = await Promise.all([
        this.getProcessedPaymentStats('default', fromTime, toTime),
        this.getProcessedPaymentStats('fallback', fromTime, toTime),
      ]);

      const result = {
        default: defaultStats,
        fallback: fallbackStats,
      };

      return result;
    } catch (error) {
      const errorMessage = this.extractErrorMessage(error);
      this.logger.error(`Error in getPaymentSummary: ${errorMessage}`);
      throw error;
    }
  }

  private async getProcessedPaymentStats(
    processorType: 'default' | 'fallback',
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
      const errorMessage = this.extractErrorMessage(error);
      this.logger.error(
        `Error getting processor stats for ${processorType}: ${errorMessage}`,
      );
      return { totalRequests: 0, totalAmount: 0 };
    }
  }

}
