import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '../../config/config.service';
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
  private previousColor: CircuitBreakerColor = CircuitBreakerColor.GREEN;
  private processor: {
    default: string;
    fallback: string;
  };
  private paymentHealth: ProcessorHealth = {
    failing: false,
    minResponseTime: 0,
  };
  private fallbackHealth: ProcessorHealth = {
    failing: false,
    minResponseTime: 0,
  };

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.processor = {
      default: `${this.configService.getProcessorDefaultUrl()}/payments/service-health`,
      fallback: `${this.configService.getProcessorFallbackUrl()}/payments/service-health`,
    };
  }

  @Cron(CronExpression.EVERY_5_SECONDS, {
    disabled: process.env.APP_MODE === 'PRODUCER',
  })
  async checkHealth(): Promise<void> {
    try {
      const defaultResponse = await lastValueFrom(this.httpService.get(this.processor.default)).catch((error) => {
        if (error?.response?.status === 429) {
          this.logger.warn(`Default processor marked as failing due to 429 error`);
          return;
        }
        return { data: { minResponseTime: 0, failing: true } };
      });

      const fallbackResponse = await lastValueFrom(this.httpService.get(this.processor.fallback)).catch((error) => {
        if (error?.response?.status === 429) {
          this.logger.warn(`Fallback processor marked as failing due to 429 error`);
          return;
        }
        return { data: { minResponseTime: 0, failing: true } };
      });

      if (!defaultResponse || !fallbackResponse) {
        return;
      }

      this.paymentHealth = defaultResponse?.data || { minResponseTime: 0, failing: true };
      this.fallbackHealth = fallbackResponse?.data || { minResponseTime: 0, failing: true };

      this.updateCircuitBreakerColor();
    } catch (error) {
      this.logger.error('Error during health check');
    }
  }

  private updateCircuitBreakerColor(): void {
    const { failing: paymentFailing, minResponseTime: paymentResponseTime } =
      this.paymentHealth;
    const { failing: fallbackFailing, minResponseTime: fallbackResponseTime } =
      this.fallbackHealth;

    const everythingUp = !paymentFailing && !fallbackFailing;
    this.previousColor = this.currentColor;

    if (paymentFailing && fallbackFailing) {
      this.currentColor = CircuitBreakerColor.RED;
    } else if (
      everythingUp &&
      (paymentResponseTime - fallbackResponseTime) >= 1000
    ) {
      this.currentColor = CircuitBreakerColor.YELLOW;
    } else if (paymentFailing && !fallbackFailing) {
      this.currentColor = CircuitBreakerColor.YELLOW;
    } else {
      this.currentColor = CircuitBreakerColor.GREEN;
    }

    this.handleQueueStateTransition();
  }

  private handleQueueStateTransition(): void {
    if (this.previousColor !== this.currentColor) {
      this.logger.debug(`Circuit breaker state transition: ${this.previousColor} -> ${this.currentColor}`);
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