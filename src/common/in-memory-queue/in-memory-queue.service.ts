import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';

@Injectable()
export class InMemoryQueueService<T> {
  private readonly queueKey: string = process.env.APP_MODE || 'app';
  private readonly logger = new Logger(InMemoryQueueService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
  ) { }

  add(item: T): void {
    const serializedItem = JSON.stringify(item);
    this.redis.rpush(this.queueKey, serializedItem).catch(e => this.logger.error('Error adding to queue'));
    return;
  }

  requeue(item: T): void {
    const serializedItem = JSON.stringify(item);
    this.redis.lpush(this.queueKey, serializedItem).catch(e => this.logger.error('Error adding to queue'));
  }
}
