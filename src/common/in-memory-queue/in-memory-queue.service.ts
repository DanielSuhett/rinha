import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { performance } from 'perf_hooks';

@Injectable()
export class InMemoryQueueService<T> {
  private readonly queueKey: string = process.env.APP_MODE || 'app';
  private readonly logger = new Logger(InMemoryQueueService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
  ) { }

  async add(item: T) {
    try {
      const start = performance.now();
      const serializedItem = JSON.stringify(item);

      await this.redis.rpush(this.queueKey, serializedItem);
      const end = performance.now();
      (end - start) > 5 && this.logger.debug(`add to the queue took ${end - start}ms`);
    } catch (error) {
      this.logger.error(`Error adding item to Redis queue: ${error.message}`);
    }
  }

  async requeue(item: T) {
    try {
      const start = performance.now();
      const serializedItem = JSON.stringify(item);
      await this.redis.lpush(this.queueKey, serializedItem);
      const end = performance.now();
      (end - start) > 5 && this.logger.debug(`requeue to the queue took ${end - start}ms`);
    } catch (error) {
      this.logger.error(`Error requeueing item to Redis queue: ${error.message}`);
    }
  }
}
