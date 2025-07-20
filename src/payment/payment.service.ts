import { Injectable } from '@nestjs/common';
import { PaymentDto, PaymentSummaryResponseDto } from './payment.dto';
import { ProcessorService } from '../processor/processor.service';
import {
  CircuitBreakerService,
  CircuitBreakerColor,
} from '../common/circuit-breaker';
import { InMemoryQueueService } from '../common/in-memory-queue/in-memory-queue.service';

@Injectable()
export class PaymentService {
  constructor(
    private readonly processorService: ProcessorService,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly inMemoryQueueService: InMemoryQueueService<PaymentDto>,
  ) { }

  async processPayment(payment: PaymentDto) {
    const currentColor = await this.circuitBreakerService.getCurrentColor();

    try {
      if (currentColor === CircuitBreakerColor.RED) {
        return this.inMemoryQueueService.requeue(payment);
      }

      if (currentColor === CircuitBreakerColor.GREEN) {
        return this.processorService.sendPaymentToProcessor(
          'default',
          payment,
        );
      }

      if (currentColor === CircuitBreakerColor.YELLOW) {
        return this.processorService.sendPaymentToProcessor(
          'fallback',
          payment,
        );
      }
    } catch (error) {
      if (error.cause === 'default') {
        this.circuitBreakerService.signal('default');
      }

      if (error.cause === 'fallback') {
        this.circuitBreakerService.signal('fallback');
      }

      this.inMemoryQueueService.requeue(payment);
    }
  }

  async getPaymentSummary(
    from?: string,
    to?: string,
  ): Promise<PaymentSummaryResponseDto> {
    if (!this.processorService) {
      throw new Error('ProcessorService not available in producer mode');
    }
    return await this.processorService.getPaymentSummary(from, to);
  }
}
