import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { CircuitBreakerColor } from './circuit-breaker.types';

@Injectable()
export class CircuitBreakerSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(CircuitBreakerSyncService.name);
  private subscriber: Redis | null = null;
  private readonly CHANNEL = 'circuit_breaker:color';
  private readonly STATE_KEY = 'circuit_breaker:current_color';
  private lastPublishedColor: CircuitBreakerColor | null = null;

  constructor(
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async publishColorChange(color: CircuitBreakerColor): Promise<void> {
    if (this.lastPublishedColor === color) {
      return;
    }

    try {
      const pipeline = this.redis.pipeline();
      pipeline.set(this.STATE_KEY, color);
      pipeline.publish(this.CHANNEL, color);
      await pipeline.exec();
      
      this.lastPublishedColor = color;
    } catch (error) {
      this.logger.error('Failed to publish color change:', error);
    }
  }

  async getInitialColor(): Promise<CircuitBreakerColor> {
    try {
      const color = await this.redis.get(this.STATE_KEY);
      return (color as CircuitBreakerColor) || CircuitBreakerColor.GREEN;
    } catch (error) {
      this.logger.error('Failed to get initial color from Redis:', error);
      return CircuitBreakerColor.GREEN;
    }
  }

  async subscribeToColorChanges(onColorChange: (color: CircuitBreakerColor) => void): Promise<void> {
    try {
      this.subscriber = this.redis.duplicate();
      
      this.subscriber.on('message', (channel: string, message: string) => {
        if (channel === this.CHANNEL) {
          onColorChange(message as CircuitBreakerColor);
        }
      });

      await this.subscriber.subscribe(this.CHANNEL);
      this.logger.log('Subscribed to circuit breaker color changes');
    } catch (error) {
      this.logger.error('Failed to subscribe to color changes:', error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe();
      this.subscriber.disconnect();
    }
  }
}