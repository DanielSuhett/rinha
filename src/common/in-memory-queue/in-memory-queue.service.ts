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

  add(item: T): void {
    const serializedItem = JSON.stringify(item);
    this.redis.rpush(this.queueKey, serializedItem).catch((e) => console.error(e));
    return;
  }

  requeue(item: string): void {
    this.redis.lpush(this.queueKey, item).catch((e) => console.error(e));
    return;
  }
}
