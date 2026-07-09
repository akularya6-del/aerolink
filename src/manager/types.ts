export type KeyStatus = 'available' | 'busy' | 'cooling' | 'disabled';

export interface ApiKey {
  id: string;
  apiKey: string;
  status: KeyStatus;
  cooldownUntil: number | null;
  lastUsed: number | null;
  requests: number;
  successes: number;
  failures: number;
  rateLimitHits: number;
  totalLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface KeyStats extends Omit<ApiKey, 'apiKey'> {
  averageLatency: number;
}

export interface ManagerConfig {
  cooldownDurationMs: number;
  retryCount: number;
  requestTimeoutMs: number;
  maxConcurrentRequests: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface StorageInterface {
  loadKeys(): Promise<ApiKey[]>;
  saveKeys(keys: ApiKey[]): Promise<void>;
}

export interface ErrorDetails {
  status?: number;
  headers?: Record<string, string>;
  message: string;
}

export interface TestResult {
  id: string;
  apiKey: string;
  status: 'ok' | 'error';
  httpStatus?: number;
  message?: string;
  latencyMs?: number;
}
