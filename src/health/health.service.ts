import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService
  ) {}

  async check() {
    const defaultProcessorUrl = this.configService.getProcessorDefaultUrl();
    const fallbackProcessorUrl = this.configService.getProcessorFallbackUrl();

    try {
      const [defaultProcessorResponse, fallbackProcessorResponse] = await Promise.all([
        lastValueFrom(this.httpService.get(`${defaultProcessorUrl}/payments/service-health`)),
        lastValueFrom(this.httpService.get(`${fallbackProcessorUrl}/payments/service-health`))
      ]);

      const defaultProcessorStatus = defaultProcessorResponse?.status || 500;
      const fallbackProcessorStatus = fallbackProcessorResponse?.status || 500;

      if (defaultProcessorStatus !== 200 || fallbackProcessorStatus !== 200) {
        throw new Error(`Default or fallback processor is down - Default: ${defaultProcessorStatus}, Fallback: ${fallbackProcessorStatus}`);
      }

      return {
        status: 'up',
        details: {
          defaultProcessor: {
            status: defaultProcessorStatus,
            health: defaultProcessorResponse?.data
          },
          fallbackProcessor: {
            status: fallbackProcessorStatus,
            health: fallbackProcessorResponse?.data
          }
        }
      };
    } catch (error) {
      console.error('Health check failed:', error);
      throw error;
    }
  }
}
