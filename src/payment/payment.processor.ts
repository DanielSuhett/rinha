import { PaymentService } from './payment.service';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PaymentDto } from './payment.dto';
import { CircuitBreakerService, CircuitBreakerColor } from '../processor/circuit-breaker.service';

@Injectable()
@Processor('payment', {
  concurrency: 5,
  limiter: {
    max: 100,
    duration: 60000,
  },
})
export class PaymentConsumer extends WorkerHost {
  private readonly logger = new Logger(PaymentConsumer.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {
    super();
  }

  async process(job: Job<PaymentDto>): Promise<string> {
    const currentColor = this.circuitBreakerService.getCurrentColor();

    if (currentColor === CircuitBreakerColor.RED) {
      this.logger.warn(`Circuit breaker is RED - delaying job ${job.data.correlationId}`);

      await job.moveToDelayed(Date.now() + 5000);
      return 'Job delayed due to circuit breaker RED state';
    }

    const startTime = Date.now();

    try {
      let result: string;

      if (currentColor === CircuitBreakerColor.GREEN) {
        // Use main processor
        result = await this.paymentService.processPayment(job.data);
        const processingTime = Date.now() - startTime;
        this.logger.log(`Payment processed via MAIN processor: ${job.data.correlationId} in ${processingTime}ms`);
      } else if (currentColor === CircuitBreakerColor.YELLOW) {
        // Use fallback processor
        result = await this.paymentService.processFallbackPayment(job.data);
        const processingTime = Date.now() - startTime;
        this.logger.log(`Payment processed via FALLBACK processor: ${job.data.correlationId} in ${processingTime}ms`);
      } else {
        throw new Error(`Unknown circuit breaker color: ${currentColor}`);
      }

      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`Payment processing failed (${currentColor}): ${job.data.correlationId} in ${processingTime}ms`, error);
      throw error;
    }
  }
}
