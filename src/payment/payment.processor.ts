import { InjectQueue, JOB_REF, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { PaymentDto } from './payment.dto';
import {
  CircuitBreakerService,
  CircuitBreakerColor,
} from '../common/circuit-breaker';
import { ProcessorService } from '../processor/processor.service';

export enum PaymentProcessor {
  DEFAULT = 'default',
  FALLBACK = 'fallback',
}
@Processor({
  name: 'payment',
})
export class PaymentConsumer extends WorkerHost {
  constructor(
    private readonly processorService: ProcessorService,
    private readonly circuitBreakerService: CircuitBreakerService,
    @Inject(JOB_REF) private job: Job<PaymentDto>,
    @InjectQueue('payment') private readonly paymentQueue: Queue,
  ) {
    super();
  }

  private async requeuePayment(data: PaymentDto, delay = 1000): Promise<void> {
    await this.paymentQueue.add('payment', data, { priority: 1, backoff: { type: 'exponential', delay: 1000 } });
  }

  async process() {
    const currentColor = await this.circuitBreakerService.getCurrentColor();

    if (currentColor === CircuitBreakerColor.RED) {
      return this.requeuePayment(this.job.data);
    }

    if (currentColor === CircuitBreakerColor.GREEN) {
      return this.processorService.processPayment(PaymentProcessor.DEFAULT, this.job.data);
    }

    if (currentColor === CircuitBreakerColor.YELLOW) {
      return this.processorService.processPayment(PaymentProcessor.FALLBACK, this.job.data);
    }
  }
}
