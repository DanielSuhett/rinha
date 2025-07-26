import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PaymentDto, Processor } from '../payment/payment.dto';
import { ConfigService } from '../config/config.service';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { CircuitBreakerService, CircuitBreakerColor } from 'src/common/circuit-breaker';
import { InMemoryQueueService } from '../common/in-memory-queue/in-memory-queue.service';
import { HttpClientService } from '../common/http/http-client.service';

@Injectable()
export class PaymentRepository implements OnModuleInit {
  private readonly PROCESSED_PAYMENTS_PREFIX = 'processed:payments';

  private processorPaymentUrl: {
    default: string;
    fallback: string;
  };

  constructor(
    private readonly httpClientService: HttpClientService,
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

  public async send(processorType: Processor, data: string): Promise<void> {
    const payment = this.newPaymentJSON(data);
    try {
      const response = await this.httpClientService.post(
        this.processorPaymentUrl[processorType],
        payment,
        { timeout: 1000 }
      );

      if (response.status === HttpStatus.OK || response.status === HttpStatus.CREATED) {
        const { amount, correlationId, requestedAt } = payment;
        await this.save(
          processorType,
          amount,
          correlationId,
          requestedAt
        ).catch(e => console.error(e));
      }
    } catch (error) {
      const color = await this.circuitBreakerService.signal(processorType);

      if (!color) {
        return;
      }

      if (color === CircuitBreakerColor.RED) {
        this.inMemoryQueueService.requeue(data);
        return;
      }

      await this.send(processorType, data);
    }
  }

  public async find(
    processorType: Processor,
    fromTime?: number,
    toTime?: number,
  ): Promise<{ totalRequests: number; totalAmount: number }> {
    try {
      const statsKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${processorType}:stats`;

      if (fromTime === undefined && toTime === undefined) {
        const [countStr, totalStr] = await this.redis.hmget(statsKey, 'count', 'total')

        return {
          totalRequests: parseInt(countStr || '0', 10),
          totalAmount: Math.round(parseFloat(totalStr || '0') * 100) / 100,
        };
      }

      const timelineKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${processorType}:timeline`;
      const min = fromTime ?? 0;
      const max = toTime ?? '+inf';

      const amounts = await this.redis.zrangebyscore(timelineKey, min, max);

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

  public async findAll(
    fromTime?: number,
    toTime?: number,
  ): Promise<{
    default: { totalRequests: number; totalAmount: number };
    fallback: { totalRequests: number; totalAmount: number };
  }> {
    try {
      const pipeline = this.redis.pipeline();

      if (fromTime === undefined && toTime === undefined) {
        const defaultStatsKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${Processor.DEFAULT}:stats`;
        const fallbackStatsKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${Processor.FALLBACK}:stats`;

        pipeline.hmget(defaultStatsKey, 'count', 'total');
        pipeline.hmget(fallbackStatsKey, 'count', 'total');

        const results = await pipeline.exec();
        if (!results || results.length < 2) {
          return {
            default: { totalRequests: 0, totalAmount: 0 },
            fallback: { totalRequests: 0, totalAmount: 0 },
          };
        }

        const [defaultResult, fallbackResult] = results;

        const [defaultCountStr, defaultTotalStr] = (defaultResult[1] as string[]) || ['0', '0'];
        const [fallbackCountStr, fallbackTotalStr] = (fallbackResult[1] as string[]) || ['0', '0'];

        return {
          default: {
            totalRequests: parseInt(defaultCountStr || '0', 10),
            totalAmount: Math.round(parseFloat(defaultTotalStr || '0') * 100) / 100,
          },
          fallback: {
            totalRequests: parseInt(fallbackCountStr || '0', 10),
            totalAmount: Math.round(parseFloat(fallbackTotalStr || '0') * 100) / 100,
          },
        };
      }

      const defaultTimelineKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${Processor.DEFAULT}:timeline`;
      const fallbackTimelineKey = `${this.PROCESSED_PAYMENTS_PREFIX}:${Processor.FALLBACK}:timeline`;
      const min = fromTime ?? 0;
      const max = toTime ?? '+inf';

      pipeline.zrangebyscore(defaultTimelineKey, min, max);
      pipeline.zrangebyscore(fallbackTimelineKey, min, max);

      const results = await pipeline.exec();
      if (!results || results.length < 2) {
        return {
          default: { totalRequests: 0, totalAmount: 0 },
          fallback: { totalRequests: 0, totalAmount: 0 },
        };
      }

      const [defaultResult, fallbackResult] = results;

      const defaultAmounts = (defaultResult[1] as string[]) || [];
      const fallbackAmounts = (fallbackResult[1] as string[]) || [];

      const processAmounts = (amounts: string[]) => {
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
      };

      return {
        default: processAmounts(defaultAmounts),
        fallback: processAmounts(fallbackAmounts),
      };
    } catch (error) {
      return {
        default: { totalRequests: 0, totalAmount: 0 },
        fallback: { totalRequests: 0, totalAmount: 0 },
      };
    }
  }
}
