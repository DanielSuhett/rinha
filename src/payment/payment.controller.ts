import { Body, Controller, Post, Get } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { PaymentDto } from './payment.dto';
import { Queue } from 'bullmq';
import { CircuitBreakerService } from '../processor/circuit-breaker.service';

@Controller('payments')
export class PaymentController {
  constructor(
    @InjectQueue('payment') private readonly paymentQueue: Queue<PaymentDto, string>,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) { }

  @Post()
  async createPayment(@Body() payment: PaymentDto) {
    await this.paymentQueue.add('payment', payment, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      }
    });
    return { message: 'Payment queued for processing' };
  }

  @Get('circuit-breaker-status')
  getCircuitBreakerStatus() {
    return this.circuitBreakerService.getHealthStatus();
  }

  @Get()
  async getSummmaryOfPayments() {
  }
}
