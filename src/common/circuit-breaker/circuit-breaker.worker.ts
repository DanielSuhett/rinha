import { parentPort } from 'worker_threads';
import axios, { AxiosRequestConfig } from 'axios';
import { Processor } from 'src/payment/payment.dto';
import {
  CircuitBreakerColor,
  ProcessorHealth,
  HealthCheckConfig,
  WorkerMessage,
  MainThreadMessage,
  WorkerMessageType,
} from './circuit-breaker.types';

class CircuitBreakerWorker {
  private config: HealthCheckConfig | null = null;
  private currentColor: CircuitBreakerColor = CircuitBreakerColor.GREEN;
  private recoveryInterval: NodeJS.Timeout | null = null;
  private lastColorChange = 0;
  private readonly COLOR_DEBOUNCE_MS = 2000;

  constructor() {
    this.setupMessageHandler();
    this.sendMessage({ type: WorkerMessageType.WORKER_READY });
  }

  private setupMessageHandler() {
    if (parentPort) {
      parentPort.on('message', (message: MainThreadMessage) => {
        this.handleMessage(message);
      });
    }
  }

  private handleMessage(message: MainThreadMessage) {
    switch (message.type) {
      case WorkerMessageType.CONFIG_UPDATE:
        this.updateConfig(message.config);
        break;
      case WorkerMessageType.SIGNAL_FAILURE:
        this.handleFailureSignal(message.processor, message.timestamp);
        break;
      case WorkerMessageType.SHUTDOWN:
        this.shutdown();
        break;
    }
  }

  private updateConfig(config: HealthCheckConfig) {
    this.config = config;
  }

  private async handleFailureSignal(processor: Processor, timestamp: number) {
    if (!this.config) return;

    const otherProcessor = processor === Processor.DEFAULT ? Processor.FALLBACK : Processor.DEFAULT;
    const health = await this.checkHealth(otherProcessor);

    if (health && !health.failing) {
      const newColor = processor === Processor.DEFAULT
        ? CircuitBreakerColor.YELLOW
        : CircuitBreakerColor.GREEN;
      this.updateColor(newColor);
    } else {
      this.updateColor(CircuitBreakerColor.RED);
      this.startRecoveryMonitoring();
    }
  }


  private startRecoveryMonitoring() {
    if (!this.config || this.recoveryInterval) return;

    this.recoveryInterval = setInterval(async () => {
      if (this.currentColor !== CircuitBreakerColor.RED) {
        this.stopRecoveryMonitoring();
        return;
      }

      const recoveredColor = await this.checkForRecovery();
      if (recoveredColor !== CircuitBreakerColor.RED) {
        this.updateColor(recoveredColor);
        this.stopRecoveryMonitoring();
      }
    }, this.config.healthInterval);
  }

  private stopRecoveryMonitoring() {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }
  }


  private async checkForRecovery(): Promise<CircuitBreakerColor> {
    if (!this.config) return CircuitBreakerColor.RED;

    const [defaultHealth, fallbackHealth] = await Promise.all([
      this.checkHealth(Processor.DEFAULT),
      this.checkHealth(Processor.FALLBACK),
    ]);

    return this.calculateColor({
      default: defaultHealth || { failing: true, minResponseTime: 0 },
      fallback: fallbackHealth || { failing: true, minResponseTime: 0 },
    });
  }

  private async checkHealth(processor: Processor): Promise<ProcessorHealth | null> {
    if (!this.config) return null;

    try {
      const url = this.config.processorUrls[processor];
      const config: AxiosRequestConfig = {
        timeout: this.config.healthTimeout,
        method: 'GET',
      };

      const response = await axios.get<ProcessorHealth>(url, config);
      return {
        minResponseTime: response.data.minResponseTime,
        failing: response.data.failing,
      };
    } catch (error: any) {
      if (error?.response?.status === 429) {
        return { minResponseTime: 0, failing: false };
      }
      return { minResponseTime: 0, failing: true };
    }
  }

  private calculateColor(processors: { default: ProcessorHealth; fallback: ProcessorHealth }): CircuitBreakerColor {
    if (!this.config) return CircuitBreakerColor.RED;

    const diff = processors.default.minResponseTime - processors.fallback.minResponseTime;

    if (processors.default.failing && processors.fallback.failing) {
      return CircuitBreakerColor.RED;
    }

    if (processors.default.failing && !processors.fallback.failing) {
      return CircuitBreakerColor.YELLOW;
    }

    if (!processors.default.failing && !processors.fallback.failing && diff >= this.config.latencyDiffToUseFallback) {
      return CircuitBreakerColor.YELLOW;
    }

    return CircuitBreakerColor.GREEN;
  }

  private updateColor(newColor: CircuitBreakerColor) {
    if (this.currentColor !== newColor) {
      const now = Date.now();
      
      if (newColor === CircuitBreakerColor.RED || now - this.lastColorChange >= this.COLOR_DEBOUNCE_MS) {
        this.currentColor = newColor;
        this.lastColorChange = now;
        this.sendMessage({
          type: WorkerMessageType.COLOR_UPDATE,
          color: newColor,
          timestamp: now,
        });
      }
    }
  }

  private sendMessage(message: WorkerMessage) {
    if (parentPort) {
      parentPort.postMessage(message);
    }
  }


  private shutdown() {
    this.stopRecoveryMonitoring();
    process.exit(0);
  }
}

new CircuitBreakerWorker();
