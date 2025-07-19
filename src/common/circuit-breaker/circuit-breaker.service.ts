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
      return;
    }

    this.poolingHealth = true;

    const healthDefault = await this.health('default', true);
    const healthFallback = await this.health('fallback', true);

    const color = this.defineTheColor({
      default: healthDefault || this.FAILURE,
      fallback: healthFallback || this.FAILURE,
    });

    if (color === CircuitBreakerColor.RED) {
      this.logger.debug(`pooling health`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      this.poolingHealth = false;
      return this.cronToCheckTheHealth();
    }

    this.logger.debug(`pooling health done`);

    this.poolingHealth = false;
    return color;
  }

  private async color(color: CircuitBreakerColor) {
    this.logger.debug(`[SWAP] color: ${color}`);
    await this.redis.hset(this.CIRCUIT_BREAKER, { color });
  }


  private async health(processor: 'default' | 'fallback', cameFromCron = false): Promise<ProcessorHealth | null> {
    try {
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

    if (process.env.APP_MODE !== 'CONSUMER') {
      return CircuitBreakerColor.RED;
    }

    const isDefault = processor === 'default';

    const health = await this.health(isDefault ? 'fallback' : 'default');

    if (health && !health.failing) {
      const color = isDefault ? CircuitBreakerColor.YELLOW : CircuitBreakerColor.GREEN;
      await this.color(color);
      return color;
    }

    if (!health || health.failing) {
      await this.color(CircuitBreakerColor.RED);

      const color = await this.cronToCheckTheHealth();

      if (color && color !== CircuitBreakerColor.RED) {
        this.logger.debug(`fast recovery with pooling health done`);
        await this.color(color);
        return color;
      }

      await this.color(CircuitBreakerColor.RED);
      return CircuitBreakerColor.RED;
    }


    const color = this.defineTheColor(isDefault ? {
      default: this.FAILURE,
      fallback: health,
    } : {
      default: health,
      fallback: this.FAILURE,
    });

    await this.color(color);

    return color;
  }
}
