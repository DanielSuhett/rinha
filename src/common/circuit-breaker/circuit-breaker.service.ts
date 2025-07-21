import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '../../config/config.service';
import { lastValueFrom } from 'rxjs';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { timeout } from 'rxjs/operators';
import { performance } from 'perf_hooks';

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
  private readonly logger = new Logger(CircuitBreakerService.name);
  private cachedColor: CircuitBreakerColor = CircuitBreakerColor.GREEN;
  private lastColorCheck = 0;
  private readonly COLOR_CHECK_DEBOUNCE = 1000;
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
  }


  private async cronToCheckTheHealth() {
    if (this.poolingHealth) {
      return CircuitBreakerColor.RED;
    }

    this.poolingHealth = true;
    this.openedHealth = false

    try {
      let cycle = 0
      this.logger.debug(`--- start pooling ---`);
      while (true) {
        const newColor = await this.getCurrentColor();

        if (newColor !== CircuitBreakerColor.RED) {
          this.logger.debug(`pooling health done by fast finding color`);
          return newColor;
        }

        const healthDefault = await this.health('default');
        const healthFallback = await this.health('fallback');

        const color = this.defineTheColor({
          default: healthDefault || this.FAILURE,
          fallback: healthFallback || this.FAILURE,
        });

        if (color !== CircuitBreakerColor.RED) {
          this.logger.debug(`--- stop pooling ---`);
          return color;
        }

        cycle += 1
        this.logger.debug(`pooling health cycle: ${cycle}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } finally {
      this.poolingHealth = false;
    }
  }

  private async color(color: CircuitBreakerColor) {
    if (this.cachedColor === color) {
      return;
    }
    this.logger.debug(`[SWAP] color: ${color}`);

    const start = performance.now();
    this.cachedColor = color;
    await this.redis.set(this.CIRCUIT_BREAKER, color);
    this.lastColorCheck = Date.now();


    const end = performance.now();

    if (end - start > 10) {
      this.logger.debug(`set color took ${end - start}ms`);
    }
  }


  private async health(processor: 'default' | 'fallback'): Promise<ProcessorHealth | null> {
    try {
      if (this.openedHealth) {
        return { minResponseTime: 0, failing: true };
      }

      const response = await lastValueFrom(this.httpService.get<ProcessorHealth>(this.processor[processor], {
        timeout: 500,
      }));

      const minResponseTime = response.data.minResponseTime;
      const failing = response.data.failing;

      return { minResponseTime, failing };
    } catch (error) {
      if (error?.response?.status === 429) {
        this.logger.debug('rate limit exceeded on health');
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

    if (!processors.default.failing && !processors.fallback.failing && diff >= 5000) {
      return CircuitBreakerColor.YELLOW;
    }

    return CircuitBreakerColor.GREEN;
  }

  async getCurrentColor(): Promise<CircuitBreakerColor> {
    const now = Date.now();

    if (now - this.lastColorCheck < this.COLOR_CHECK_DEBOUNCE) {
      return this.cachedColor;
    }

    const start = performance.now();
    const color = await this.redis.get(this.CIRCUIT_BREAKER);
    this.cachedColor = color as CircuitBreakerColor || CircuitBreakerColor.GREEN;
    this.lastColorCheck = now;

    const end = performance.now();

    if (end - start > 10) {
      this.logger.debug(`getCurrentColor took ${end - start}ms`);
    }

    return this.cachedColor;
  }


  async signal(processor: 'default' | 'fallback'): Promise<CircuitBreakerColor | null> {
    const start = performance.now();
    if (this.poolingHealth) {
      return CircuitBreakerColor.RED;
    }

    const isDefault = processor === 'default';

    this.openedHealth = true;
    const otherProcessor = isDefault ? 'fallback' : 'default';
    const health = await this.health(otherProcessor);
    this.openedHealth = false;

    if (health && !health.failing) {
      const newColor = isDefault ? CircuitBreakerColor.YELLOW : CircuitBreakerColor.GREEN;
      await this.color(newColor);

      const end = performance.now();
      if (end - start > 10) {
        this.logger.debug(`signal took ${end - start}ms`);
      }
      return newColor;
    }

    await this.color(CircuitBreakerColor.RED);
    this.cronToCheckTheHealth().then((recoveredColor) => {
      if (recoveredColor && recoveredColor !== CircuitBreakerColor.RED) {
        this.color(recoveredColor);
      }
    });

    await this.color(CircuitBreakerColor.RED);
    const end = performance.now();
    if (end - start > 10) {
      this.logger.debug(`signal took ${end - start}ms`);
    }
    return CircuitBreakerColor.RED;
  }
}
