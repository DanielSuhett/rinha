import { Processor } from 'src/payment/payment.dto';

export enum CircuitBreakerColor {
  GREEN = 'green',
  YELLOW = 'yellow',
  RED = 'red',
}

export interface ProcessorHealth {
  failing: boolean;
  minResponseTime: number;
}

export interface HealthCheckConfig {
  processorUrls: {
    default: string;
    fallback: string;
  };
  healthInterval: number;
  healthTimeout: number;
  latencyDiffToUseFallback: number;
}

export enum WorkerMessageType {
  COLOR_UPDATE = 'COLOR_UPDATE',
  CONFIG_UPDATE = 'CONFIG_UPDATE',
  SIGNAL_FAILURE = 'SIGNAL_FAILURE',
  WORKER_READY = 'WORKER_READY',
  SHUTDOWN = 'SHUTDOWN',
}

export interface ColorUpdateMessage {
  type: WorkerMessageType.COLOR_UPDATE;
  color: CircuitBreakerColor;
  timestamp: number;
}

export interface ConfigUpdateMessage {
  type: WorkerMessageType.CONFIG_UPDATE;
  config: HealthCheckConfig;
}

export interface SignalFailureMessage {
  type: WorkerMessageType.SIGNAL_FAILURE;
  processor: Processor;
  timestamp: number;
}

export interface WorkerReadyMessage {
  type: WorkerMessageType.WORKER_READY;
}

export interface ShutdownMessage {
  type: WorkerMessageType.SHUTDOWN;
}

export type WorkerMessage = 
  | ColorUpdateMessage 
  | ConfigUpdateMessage 
  | SignalFailureMessage
  | WorkerReadyMessage
  | ShutdownMessage;

export type MainThreadMessage = 
  | ConfigUpdateMessage 
  | SignalFailureMessage
  | ShutdownMessage;