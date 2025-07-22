import { Module } from '@nestjs/common';
import { InMemoryQueueService } from './in-memory-queue.service';
import { ConfigModule } from '../../config/config.module';

@Module({
  imports: [ConfigModule],
  providers: [InMemoryQueueService],
  exports: [InMemoryQueueService],
})
export class InMemoryQueueModule {}
