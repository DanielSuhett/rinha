import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HealthService } from './health.service';
import { HealthController } from './health.controller';

@Module({
	imports: [HttpModule.register({})],
	providers: [HealthService],
	controllers: [HealthController],
	exports: [HealthService],
})
export class HealthModule {}
