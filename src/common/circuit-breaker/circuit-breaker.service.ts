import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { Processor } from 'src/payment/payment.dto';
import { HttpClientService } from '../http/http-client.service';

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
  private processor: {
    default: string;
    fallback: string;
  };
  private readonly FAILURE = { failing: true, minResponseTime: 0 };

  private cachedColor: CircuitBreakerColor = CircuitBreakerColor.GREEN;


  private readonly HEALTH_INTERVAL: number;
  private readonly HEALTH_TIMEOUT: number;
  private readonly LATENCY_DIFF_TO_USE_FALLBACK: number;

  private openedHealth = false;
  private poolingHealth = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpClientService: HttpClientService,
  ) {
    this.processor = {
      default: `${this.configService.getProcessorDefaultUrl()}/payments/service-health`,
      fallback: `${this.configService.getProcessorFallbackUrl()}/payments/service-health`,
    };

    const {
      healthInterval,
      healthTimeout,
      latencyDiffToUseFallback,
    } = this.configService.getConstraints()

    this.HEALTH_INTERVAL = healthInterval;
    this.HEALTH_TIMEOUT = healthTimeout;
    this.LATENCY_DIFF_TO_USE_FALLBACK = latencyDiffToUseFallback;
  }


  private async cronToCheckTheHealth() {
    if (this.poolingHealth) {
      return CircuitBreakerColor.RED;
    }

    this.poolingHealth = true;
    this.openedHealth = false

    try {
      while (true) {
        const newColor = this.getCurrentColor();

        if (newColor !== CircuitBreakerColor.RED) {
          return newColor;
        }

        const healthDefault = await this.health(Processor.DEFAULT);
        const healthFallback = await this.health(Processor.FALLBACK);

        const color = this.defineTheColor({
          default: healthDefault || this.FAILURE,
          fallback: healthFallback || this.FAILURE,
        });

        if (color !== CircuitBreakerColor.RED) {
          return color;
        }

        await new Promise((resolve) => setTimeout(resolve, this.HEALTH_INTERVAL));
      }
    } finally {
      this.poolingHealth = false;
    }
  }

  private color(color: CircuitBreakerColor) {
    if (this.cachedColor === color) {
      return;
    }

    this.cachedColor = color;
  }


  private async health(processor: Processor): Promise<ProcessorHealth | null> {
    try {
      if (this.openedHealth) {
        return { minResponseTime: 0, failing: true };
      }

      const response = await this.httpClientService.get<ProcessorHealth>(this.processor[processor], {
        timeout: this.HEALTH_TIMEOUT,
      });

      const minResponseTime = response.data.minResponseTime;
      const failing = response.data.failing;

      return { minResponseTime, failing };
    } catch (error) {
      if (error?.response?.status === 429) {
        return { minResponseTime: 0, failing: false };
      }
      return { minResponseTime: 0, failing: true };
    }
  }

  private defineTheColor(processors: { default: ProcessorHealth, fallback: ProcessorHealth }): CircuitBreakerColor {
    const diff = processors.default.minResponseTime - processors.fallback.minResponseTime;

    if (processors.default.failing && processors.fallback.failing) {
      return CircuitBreakerColor.RED;
    }

    if (processors.default.failing && !processors.fallback.failing) {
      return CircuitBreakerColor.YELLOW;
    }

    if (!processors.default.failing && !processors.fallback.failing && diff >= this.LATENCY_DIFF_TO_USE_FALLBACK) {
      return CircuitBreakerColor.YELLOW;
    }

    return CircuitBreakerColor.GREEN;
  }

  getCurrentColor(): CircuitBreakerColor {
    return this.cachedColor;
  }


  async signal(processor: Processor): Promise<CircuitBreakerColor | null> {
    if (this.poolingHealth) {
      return CircuitBreakerColor.RED;
    }

    const isDefault = processor === Processor.DEFAULT;

    this.openedHealth = true;
    const otherProcessor = isDefault ? Processor.FALLBACK : Processor.DEFAULT;
    const health = await this.health(otherProcessor);
    this.openedHealth = false;

    if (health && !health.failing) {
      const newColor = isDefault ? CircuitBreakerColor.YELLOW : CircuitBreakerColor.GREEN;
      this.color(newColor);
      return newColor;
    }

    this.color(CircuitBreakerColor.RED);

    this.cronToCheckTheHealth().then((recoveredColor) => {
      if (recoveredColor && recoveredColor !== CircuitBreakerColor.RED) {
        this.color(recoveredColor);
      }
    });

    return CircuitBreakerColor.RED;
  }
}
