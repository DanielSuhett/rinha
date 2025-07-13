import { Injectable } from '@nestjs/common';
import { validateEnvironment, Environment } from './environment.config';

@Injectable()
export class ConfigService {
	private readonly config: Environment;

	constructor() {
		this.config = validateEnvironment();
	}

	getConfig(): Environment {
		return this.config;
	}

	getAppPort(): number {
		return this.config.APP_PORT;
	}

	getRedisHost(): string {
		return this.config.REDIS_HOST;
	}

	getRedisPort(): number {
		return this.config.REDIS_PORT;
	}

	getProcessorDefaultUrl(): string {
		return this.config.PROCESSOR_DEFAULT_URL;
	}

	getProcessorFallbackUrl(): string {
		return this.config.PROCESSOR_FALLBACK_URL;
	}

	getInstanceId(): string | undefined {
		return this.config.INSTANCE_ID;
	}

	getWorkerConcurrency(): number {
		return this.config.WORKER_CONCURRENCY;
	}
} 