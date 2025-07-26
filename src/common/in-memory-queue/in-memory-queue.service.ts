import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Redis } from 'ioredis';
import { ConfigService } from 'src/config/config.service';

@Injectable()
export class InMemoryQueueService<T> {
  private readonly queueKey: string;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {
    this.queueKey = this.configService.getRedisKeyPrefix()
  }

  add(item: string): void {
    setImmediate(() => this.redis.lpush(this.queueKey, JSON.stringify(item)));
  }

  requeue(item: string): void {
    setImmediate(() => this.redis.lpush(this.queueKey, item));
  }
}
