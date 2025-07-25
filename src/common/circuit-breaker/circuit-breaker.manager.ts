import { Worker } from 'worker_threads';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as path from 'path';
import { Processor } from 'src/payment/payment.dto';
import {
  CircuitBreakerColor,
  HealthCheckConfig,
  WorkerMessage,
  MainThreadMessage,
  WorkerMessageType,
} from './circuit-breaker.types';

@Injectable()
export class CircuitBreakerManager implements OnModuleDestroy {
  private worker: Worker | null = null;
  private currentColor: CircuitBreakerColor = CircuitBreakerColor.GREEN;
  private isWorkerReady = false;
  private readonly logger = new Logger(CircuitBreakerManager.name);
  private restartAttempts = 0;
  private readonly MAX_RESTART_ATTEMPTS = 2;
  private readonly RESTART_DELAY = 1000;

  async initialize(config: HealthCheckConfig): Promise<void> {
    await this.startWorker();
    if (this.isWorkerReady) {
      this.sendConfigToWorker(config);
    }
  }

  private async startWorker(): Promise<void> {
    if (this.worker) {
      await this.stopWorker();
    }

    try {
      const workerPath = path.join(__dirname, 'circuit-breaker.worker.js');
      this.worker = new Worker(workerPath);

      this.setupWorkerListeners();

      await this.waitForWorkerReady();
      this.restartAttempts = 0;
      this.logger.log('Circuit breaker worker started successfully');
    } catch (error) {
      this.logger.error('Failed to start circuit breaker worker:', error);
      await this.handleWorkerRestart();
    }
  }

  private setupWorkerListeners(): void {
    if (!this.worker) return;

    this.worker.on('message', (message: WorkerMessage) => {
      this.handleWorkerMessage(message);
    });

    this.worker.on('error', (error) => {
      this.logger.error('Circuit breaker worker error:', error);
      this.handleWorkerRestart();
    });

    this.worker.on('exit', (code) => {
      this.logger.warn(`Circuit breaker worker exited with code ${code}`);
      if (code !== 0) {
        this.handleWorkerRestart();
      }
    });
  }

  private handleWorkerMessage(message: WorkerMessage): void {
    switch (message.type) {
      case WorkerMessageType.COLOR_UPDATE:
        this.currentColor = message.color;
        this.logger.debug(`Color updated to: ${message.color}`);
        break;
      case WorkerMessageType.WORKER_READY:
        this.isWorkerReady = true;
        this.logger.log('Circuit breaker worker is ready');
        break;
    }
  }

  private async waitForWorkerReady(timeout = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkReady = () => {
        if (this.isWorkerReady) {
          resolve();
        } else if (Date.now() - startTime > timeout) {
          reject(new Error('Worker ready timeout'));
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    });
  }

  private async handleWorkerRestart(): Promise<void> {
    if (this.restartAttempts >= this.MAX_RESTART_ATTEMPTS) {
      this.logger.error('Maximum worker restart attempts reached');
      this.currentColor = CircuitBreakerColor.RED;
      return;
    }

    this.restartAttempts++;
    this.isWorkerReady = false;
    this.currentColor = CircuitBreakerColor.RED;

    this.logger.warn(`Attempting to restart worker (attempt ${this.restartAttempts}/${this.MAX_RESTART_ATTEMPTS})`);

    await this.sleep(this.RESTART_DELAY * this.restartAttempts);
    await this.startWorker();
  }

  private sendConfigToWorker(config: HealthCheckConfig): void {
    this.sendMessageToWorker({
      type: WorkerMessageType.CONFIG_UPDATE,
      config,
    });
  }

  private sendMessageToWorker(message: MainThreadMessage): void {
    if (this.worker && this.isWorkerReady) {
      this.worker.postMessage(message);
    } else {
      this.logger.warn('Cannot send message to worker: worker not ready');
    }
  }

  getCurrentColor(): CircuitBreakerColor {
    return this.currentColor;
  }

  async signalFailure(processor: Processor): Promise<CircuitBreakerColor> {
    this.sendMessageToWorker({
      type: WorkerMessageType.SIGNAL_FAILURE,
      processor,
      timestamp: Date.now(),
    });

    this.currentColor = CircuitBreakerColor.RED;
    return this.currentColor;
  }

  private async stopWorker(): Promise<void> {
    if (this.worker) {
      this.sendMessageToWorker({ type: WorkerMessageType.SHUTDOWN });

      return new Promise((resolve) => {
        if (this.worker) {
          this.worker.once('exit', () => {
            this.worker = null;
            this.isWorkerReady = false;
            resolve();
          });

          setTimeout(() => {
            if (this.worker) {
              this.worker.terminate();
              this.worker = null;
              this.isWorkerReady = false;
            }
            resolve();
          }, 5000);
        } else {
          resolve();
        }
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopWorker();
  }
}