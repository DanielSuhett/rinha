import { Body, Controller, Post, Get, Query, Logger } from '@nestjs/common';
import {
  PaymentDto,
  PaymentSummaryQueryDto,
  PaymentSummaryResponseDto,
} from './payment.dto';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '../config/config.service';
import { ProcessorService } from '../processor/processor.service';
import { lastValueFrom } from 'rxjs';
import { InMemoryQueueService } from '../common/in-memory-queue/in-memory-queue.service';

@Controller()
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly inMemoryQueueService: InMemoryQueueService<PaymentDto>,
    private readonly processorService: ProcessorService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  @Post('payments')
  async createPayment(@Body() payment: PaymentDto) {
    this.inMemoryQueueService.add(payment);
    return;
  }

  @Get('payments-summary')
  async getPaymentSummary(
    @Query() query: PaymentSummaryQueryDto,
  ): Promise<PaymentSummaryResponseDto> {
    const result = await this.processorService.getPaymentSummary(
      query.from,
      query.to,
    );
    return result;
  }

  @Post('purge-payments')
  async purgePayments() {
    const defaultProcessorUrl = this.configService.getProcessorDefaultUrl();
    const fallbackProcessorUrl = this.configService.getProcessorFallbackUrl();

    const headers = {
      'X-Rinha-Token': '123',
    };

    const [defaultResponse, fallbackResponse] = await Promise.allSettled([
      lastValueFrom(
        this.httpService.post(
          `${defaultProcessorUrl}/admin/purge-payments`,
          {},
          { headers },
        ),
      ),
      lastValueFrom(
        this.httpService.post(
          `${fallbackProcessorUrl}/admin/purge-payments`,
          {},
          { headers },
        ),
      ),
    ]);

    return {
      message: 'Purge payments completed',
      results: {
        default: defaultResponse.status === 'fulfilled' ? 'success' : 'failed',
        fallback:
          fallbackResponse.status === 'fulfilled' ? 'success' : 'failed',
      },
    };
  }
}
