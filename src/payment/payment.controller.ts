import { Body, Controller, Post, Get, Query, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  PaymentDto,
  PaymentSummaryQueryDto,
  PaymentSummaryResponseDto,
} from './payment.dto';
import { Queue } from 'bullmq';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '../config/config.service';
import { ProcessorService } from '../processor/processor.service';
import { lastValueFrom } from 'rxjs';

@Controller()
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    @InjectQueue('payment')
    private readonly paymentQueue: Queue<PaymentDto, string>,
    private readonly processorService: ProcessorService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) { }

  @Post('payments')
  async createPayment(@Body() payment: PaymentDto) {
    const start = Date.now();

    await this.paymentQueue.add('payment', payment);

    const elapsed = Date.now() - start;
    if (elapsed > 1) {
      this.logger.debug(`createPayment: Queuing took ${elapsed}ms`);
      return { message: 'Payment queued for processing' };
    }
  }

  @Get('payments-summary')
  async getPaymentSummary(
    @Query() query: PaymentSummaryQueryDto,
  ): Promise<PaymentSummaryResponseDto> {
    const start = Date.now();
    const result = await this.processorService.getPaymentSummary(query.from, query.to);
    const elapsed = Date.now() - start;
    this.logger.debug(`getPaymentSummary: Processing took ${elapsed}ms`);
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

  private extractErrorMessage(error: any): string {
    if (error?.response) {
      return `HTTP ${error.response.status} - ${error.response.statusText || 'Unknown'} (${error.config?.url || 'unknown URL'})`;
    }
    if (error?.code) {
      return `${error.code}: ${error.message}`;
    }
    return error?.message || 'Unknown error';
  }
}
