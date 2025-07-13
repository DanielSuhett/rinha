import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '../config/config.service';
import { lastValueFrom } from 'rxjs';

export enum CircuitBreakerColor {
  GREEN = 'green',
  YELLOW = 'yellow',
  RED = 'red',
}

export interface ProcessorHealth {
  failing: boolean;
  minResponseTime: number;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private currentColor: CircuitBreakerColor = CircuitBreakerColor.GREEN;
  private paymentHealth: ProcessorHealth = { failing: false, minResponseTime: 0 };
  private fallbackHealth: ProcessorHealth = { failing: false, minResponseTime: 0 };

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  @Cron('*/5 * * * * *')
  async checkHealth(): Promise<void> {
    try {
      await Promise.all([
        this.checkPaymentHealth(),
        this.checkFallbackHealth(),
      ]);

      this.updateCircuitBreakerColor();
      this.logger.log(`Circuit breaker status: ${this.currentColor}`);
    } catch (error) {
      this.logger.error('Error during health check:', error);
    }
  }

  private async checkPaymentHealth(): Promise<void> {
    const url = `${this.configService.getProcessorDefaultUrl()}/payments/service-health`;
    try {
      const response = await lastValueFrom(this.httpService.get(url));
      this.paymentHealth = response.data;
    } catch (error) {
      this.paymentHealth = { failing: true, minResponseTime: 0 };
      this.logger.warn('Payment processor health check failed');
    }
  }

  private async checkFallbackHealth(): Promise<void> {
    const url = `${this.configService.getProcessorFallbackUrl()}/payments/service-health`;
    try {
      const response = await lastValueFrom(this.httpService.get(url));
      this.fallbackHealth = response.data;
    } catch (error) {
      this.fallbackHealth = { failing: true, minResponseTime: 0 };
      this.logger.warn('Fallback processor health check failed');
    }
  }

  private updateCircuitBreakerColor(): void {
    const { failing: paymentFailing, minResponseTime: paymentResponseTime } = this.paymentHealth;
    const { failing: fallbackFailing } = this.fallbackHealth;

    if (!paymentFailing && paymentResponseTime <= 5000) {
      this.currentColor = CircuitBreakerColor.GREEN;
    } else if ((paymentFailing || paymentResponseTime > 5000) && !fallbackFailing) {
      this.currentColor = CircuitBreakerColor.YELLOW;
    } else if (paymentFailing && fallbackFailing) {
      this.currentColor = CircuitBreakerColor.RED;
    } else {
      this.currentColor = CircuitBreakerColor.GREEN;
    }
  }

  getCurrentColor(): CircuitBreakerColor {
    return this.currentColor;
  }

  getHealthStatus() {
    return {
      color: this.currentColor,
      payment: this.paymentHealth,
      fallback: this.fallbackHealth,
    };
  }
}