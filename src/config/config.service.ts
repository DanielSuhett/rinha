import { Injectable } from '@nestjs/common';
import { validateEnvironment, Environment } from './environment.config';

@Injectable()
export class ConfigService {
  private readonly config: Environment;
  private static _instance: ConfigService;

  constructor() {
    if (ConfigService._instance) {
      return ConfigService._instance;
    }

    this.config = validateEnvironment();
    ConfigService._instance = this;
  }

  getConfig(): Environment {
    return this.config;
  }

  getAppPort(): number {
    return this.config.APP_PORT;
  }

  getAppMode(): 'PRODUCER' | 'CONSUMER' {
    return this.config.APP_MODE;
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

  getRedisConfig() {
    return {
      host: this.config.REDIS_HOST,
      port: this.config.REDIS_PORT,
    };
  }

  getProcessorUrls() {
    return {
      default: this.config.PROCESSOR_DEFAULT_URL,
      fallback: this.config.PROCESSOR_FALLBACK_URL,
    };
  }

  getConstraints() {
    return {
      pollingInterval: this.config.POOLING_INTERVAL,
      healthInterval: this.config.HEALTH_INTERVAL,
      healthTimeout: this.config.HEALTH_TIMEOUT,
      latencyDiffToUseFallback: this.config.LATENCY_DIFF_TO_USE_FALLBACK,
    }
  }

  getRedisKeyPrefix(): string {
    return this.config.APP_MODE === 'PRODUCER' ? 'prod:' : 'cons:';
  }
}
