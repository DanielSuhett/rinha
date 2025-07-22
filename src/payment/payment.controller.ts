import { Body, Controller, Post, Get, Query } from '@nestjs/common';
import {
  PaymentDto,
  PaymentSummaryQueryDto,
  PaymentSummaryResponseDto,
} from './payment.dto';
import { PaymentService } from './payment.service';
import { InMemoryQueueService } from '../common/in-memory-queue/in-memory-queue.service';

@Controller()
export class PaymentController {
  constructor(
    private readonly inMemoryQueueService: InMemoryQueueService<PaymentDto>,
    private readonly paymentService: PaymentService,
  ) {}

  @Post('payments')
  async createPayment(@Body() payment: PaymentDto) {
    this.inMemoryQueueService.add(payment)
    return;
  }

  @Get('payments-summary')
  async getPaymentSummary(
    @Query() query: PaymentSummaryQueryDto,
  ): Promise<PaymentSummaryResponseDto> {
    const result = await this.paymentService.getPaymentSummary(
      query.from,
      query.to,
    );
    return result;
  }

}
