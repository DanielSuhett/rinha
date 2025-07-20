import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '../../config/config.service';
import { lastValueFrom } from 'rxjs';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { timeout } from 'rxjs/operators';

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

  private poolingHealth = false;

  private async cronToCheckTheHealth() {
    if (this.poolingHealth) {
      return CircuitBreakerColor.RED;
    }

    this.poolingHealth = true;

    try {
      while (true) {
        const healthDefault = await this.health('default', true);
        const healthFallback = await this.health('fallback', true);

        const color = this.defineTheColor({
          default: healthDefault || this.FAILURE,
          fallback: healthFallback || this.FAILURE,
        });

        if (color !== CircuitBreakerColor.RED) {
          this.logger.debug(`pooling health done`);
          return color;
        }

        this.logger.debug(`pooling health`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } finally {
      this.poolingHealth = false;
    }
  }

  private async color(color: CircuitBreakerColor) {
    this.logger.debug(`[SWAP] color: ${color}`);
    await this.redis.hset(this.CIRCUIT_BREAKER, { color });
  }

  private openedHealth = false;

  private async health(processor: 'default' | 'fallback', cameFromCron = false): Promise<ProcessorHealth | null> {
    try {
      if (this.openedHealth) {
        return { minResponseTime: 0, failing: true };
      }

      const response = await lastValueFrom(this.httpService.get<ProcessorHealth>(this.processor[processor]).pipe(timeout(5000)));

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

    if (!processors.default.failing && !processors.fallback.failing && diff >= 1000) {
      return CircuitBreakerColor.YELLOW;
    }

    return CircuitBreakerColor.GREEN;
  }

  async getCurrentColor(): Promise<CircuitBreakerColor> {
    const color = await this.redis.hget(this.CIRCUIT_BREAKER, 'color');
    return color as CircuitBreakerColor || CircuitBreakerColor.GREEN;
  }


  async signal(processor: 'default' | 'fallback'): Promise<CircuitBreakerColor | null> {
    if (this.poolingHealth) {
      return CircuitBreakerColor.RED;
    }

    // TODO: refactor to use containers queues in memory to not share state to retry.

    const isDefault = processor === 'default';

    this.openedHealth = true;
    const otherProcessor = isDefault ? 'fallback' : 'default';
    const health = await this.health(otherProcessor);
    this.openedHealth = false;

    // Case 1: The other processor is healthy.
    if (health && !health.failing) {
      // If default failed, we go to YELLOW. If fallback failed, we go to GREEN.
      const newColor = isDefault ? CircuitBreakerColor.YELLOW : CircuitBreakerColor.GREEN;
      await this.color(newColor);

      return newColor;
    }

    // Case 2: The other processor is also failing (or health check failed).
    // This means both are down. Go to RED and start cron job to recover.
    await this.color(CircuitBreakerColor.RED);
    this.cronToCheckTheHealth().then((recoveredColor) => {
      if (recoveredColor && recoveredColor !== CircuitBreakerColor.RED) {
        this.color(recoveredColor);
      }
    });

    // Stay in RED state.
    await this.color(CircuitBreakerColor.RED);
    return CircuitBreakerColor.RED;
  }
}
