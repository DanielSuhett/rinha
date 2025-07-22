import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '../../config/config.service';
import { lastValueFrom } from 'rxjs';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { timeout } from 'rxjs/operators';
import { performance } from 'perf_hooks';
import { Processor } from 'src/payment/payment.dto';

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
  private readonly CIRCUIT_BREAKER = 'circuit-breaker-color';
  private readonly FAILURE = { failing: true, minResponseTime: 0 };

  private cachedColor: CircuitBreakerColor = CircuitBreakerColor.GREEN;

  private lastColorCheck = 0;

  private readonly COLOR_DEBOUNCE: number;
  private readonly HEALTH_INTERVAL: number;
  private readonly HEALTH_TIMEOUT: number;
  private readonly LATENCY_DIFF_TO_USE_FALLBACK: number;

  private openedHealth = false;
  private poolingHealth = false;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.processor = {
      default: `${this.configService.getProcessorDefaultUrl()}/payments/service-health`,
      fallback: `${this.configService.getProcessorFallbackUrl()}/payments/service-health`,
    };

    const {
      colorDebounce,
      healthInterval,
      healthTimeout,
      latencyDiffToUseFallback,
    } = this.configService.getConstraints()

    this.COLOR_DEBOUNCE = colorDebounce;
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
        const newColor = await this.getCurrentColor();

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

  private async color(color: CircuitBreakerColor) {
    if (this.cachedColor === color) {
      return;
    }

    this.cachedColor = color;
    await this.redis.set(this.CIRCUIT_BREAKER, color);
    this.lastColorCheck = Date.now();
  }


  private async health(processor: Processor): Promise<ProcessorHealth | null> {
    try {
      if (this.openedHealth) {
        return { minResponseTime: 0, failing: true };
      }

      const response = await lastValueFrom(this.httpService.get<ProcessorHealth>(this.processor[processor], {
        timeout: this.HEALTH_TIMEOUT,
      }));

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

  async getCurrentColor(): Promise<CircuitBreakerColor> {
    const now = Date.now();

    if (now - this.lastColorCheck < this.COLOR_DEBOUNCE) {
      return this.cachedColor;
    }
    const color = await this.redis.get(this.CIRCUIT_BREAKER);
    this.cachedColor = color as CircuitBreakerColor || CircuitBreakerColor.GREEN;
    this.lastColorCheck = now;

    return this.cachedColor;
  }


  async signal(processor: Processor): Promise<CircuitBreakerColor | null> {
    if (this.poolingHealth) {
      return CircuitBreakerColor.RED;
    }

    const isDefault = processor === Processor.DEFAULT;

    this.openedHealth = true;
    const otherProcessor = isDefault ? Processor.FALLBACK :Processor.DEFAULT;
    const health = await this.health(otherProcessor);
    this.openedHealth = false;

    if (health && !health.failing) {
      const newColor = isDefault ? CircuitBreakerColor.YELLOW : CircuitBreakerColor.GREEN;
      await this.color(newColor);
      return newColor;
    }

    await this.color(CircuitBreakerColor.RED);

    this.cronToCheckTheHealth().then((recoveredColor) => {
      if (recoveredColor && recoveredColor !== CircuitBreakerColor.RED) {
        this.color(recoveredColor);
      }
    });

    return CircuitBreakerColor.RED;
  }
}
