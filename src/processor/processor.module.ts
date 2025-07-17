import { Module, DynamicModule } from '@nestjs/common';
import { ProcessorService } from './processor.service';
import { ConfigModule } from '../config/config.module';
import { Logger } from '@nestjs/common';

@Module({})
export class ProcessorModule {
	static forProducer(): DynamicModule {
		return {
			module: ProcessorModule,
			imports: [ConfigModule],
			providers: [ProcessorService, Logger],
			exports: [ProcessorService],
		};
	}

	static forConsumer(): DynamicModule {
		return {
			module: ProcessorModule,
			imports: [ConfigModule],
			providers: [ProcessorService, Logger],
			exports: [ProcessorService],
		};
	}
}
