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

  processPayment(payment: string) {
    const currentColor = this.circuitBreakerService.getCurrentColor();

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

    return;
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

      const result = await this.paymentRepository.findAll(fromTime, toTime);

      return result;
    } catch (error) {
      throw error;
    }
  }
}
