import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { Processor } from 'src/payment/payment.dto';
import { CircuitBreakerManager } from './circuit-breaker.manager';
import { 
  CircuitBreakerColor, 
  ProcessorHealth, 
  HealthCheckConfig 
} from './circuit-breaker.types';

@Injectable()
export class CircuitBreakerService implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService,
    private readonly circuitBreakerManager: CircuitBreakerManager,
  ) {}

  async onModuleInit() {
    const config: HealthCheckConfig = {
      processorUrls: {
        default: `${this.configService.getProcessorDefaultUrl()}/payments/service-health`,
        fallback: `${this.configService.getProcessorFallbackUrl()}/payments/service-health`,
      },
      ...this.configService.getConstraints()
    };

    await this.circuitBreakerManager.initialize(config);
  }

  getCurrentColor(): CircuitBreakerColor {
    return this.circuitBreakerManager.getCurrentColor();
  }

  async signal(processor: Processor): Promise<CircuitBreakerColor | null> {
    return await this.circuitBreakerManager.signalFailure(processor);
  }
}
