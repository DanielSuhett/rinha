import { Controller, Get } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';

@Controller('processor')
export class ProcessorController {
  constructor(private readonly circuitBreakerService: CircuitBreakerService) {}

  @Get('circuit-breaker-status')
  getCircuitBreakerStatus() {
    return this.circuitBreakerService.getHealthStatus();
  }
}