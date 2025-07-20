import { Module } from '@nestjs/common';
import { InMemoryQueueService } from './in-memory-queue.service';
import { RedisModule } from '@nestjs-modules/ioredis';

@Module({
  imports: [RedisModule],
  providers: [InMemoryQueueService],
  exports: [InMemoryQueueService],
})
export class InMemoryQueueModule { }
