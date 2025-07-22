import { Injectable } from '@nestjs/common';
import { PaymentDto, PaymentSummaryResponseDto, Processor } from './payment.dto';
import { PaymentRepository } from './payment.repository';

import {
  CircuitBreakerService,
  CircuitBreakerColor,
} from '../common/circuit-breaker';
import { InMemoryQueueService } from '../common/in-memory-queue/in-memory-queue.service';

@Injectable()
export class PaymentService {
  constructor(
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly inMemoryQueueService: InMemoryQueueService<PaymentDto>,
    private readonly paymentRepository: PaymentRepository
  ) { }

  async processPayment(payment: string) {
    const currentColor = await this.circuitBreakerService.getCurrentColor();

    try {
      if (currentColor === CircuitBreakerColor.RED) {
        return this.inMemoryQueueService.requeue(payment);
      }

      if (currentColor === CircuitBreakerColor.GREEN) {
        return this.paymentRepository.send(
          Processor.DEFAULT,
          payment,
        );
      }

      if (currentColor === CircuitBreakerColor.YELLOW) {
        return this.paymentRepository.send(
          Processor.FALLBACK,
          payment,
        );
      }
    } catch (error) {
      if (error.cause === Processor.DEFAULT) {
        this.circuitBreakerService.signal(Processor.DEFAULT);
      }

      if (error.cause === Processor.FALLBACK) {
        this.circuitBreakerService.signal(Processor.FALLBACK);
      }

      this.inMemoryQueueService.requeue(payment);
    }
  }

  async getPaymentSummary(
    from?: string,
    to?: string,
  ): Promise<PaymentSummaryResponseDto> {
    try {
      const fromDate = from ? new Date(from) : undefined;
      const toDate = to ? new Date(to) : undefined;

      const fromTime = fromDate?.getTime() ?? undefined;
      const toTime = toDate?.getTime() ?? undefined;


      const [defaultStats, fallbackStats] = await Promise.all([
        this.paymentRepository.find(Processor.DEFAULT, fromTime, toTime),
        this.paymentRepository.find(Processor.FALLBACK, fromTime, toTime),
      ]);

      const result = {
        default: defaultStats,
        fallback: fallbackStats,
      };

      return result;
    } catch (error) {
      throw error;
    }
  }
}
