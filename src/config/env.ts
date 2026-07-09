import dotenv from 'dotenv';
import { ManagerConfig, ApiKey } from '../manager/types.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config(); // also load from cwd

export function loadEnvConfig(): { config: ManagerConfig; keysFromEnv: Partial<ApiKey>[] } {
  const COOLDOWN_DURATION_MS = parseInt(process.env.COOLDOWN_DURATION_MS || '18000000', 10);
  const RETRY_COUNT = parseInt(process.env.RETRY_COUNT || '3', 10);
  const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10);
  const MAX_CONCURRENT_REQUESTS = parseInt(process.env.MAX_CONCURRENT_REQUESTS || '100', 10);
  const LOG_LEVEL = (process.env.LOG_LEVEL || 'info') as ManagerConfig['logLevel'];

  const config: ManagerConfig = {
    cooldownDurationMs: COOLDOWN_DURATION_MS,
    retryCount: RETRY_COUNT,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    maxConcurrentRequests: MAX_CONCURRENT_REQUESTS,
    logLevel: LOG_LEVEL,
  };

  const keysFromEnv: Partial<ApiKey>[] = [];

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('AEROLINK_KEY_') && value) {
      keysFromEnv.push({
        id: key,
        apiKey: value,
        status: 'available',
        cooldownUntil: null,
        lastUsed: null,
        requests: 0,
        successes: 0,
        failures: 0,
        rateLimitHits: 0,
        totalLatencyMs: 0,
      });
    }
  }

  return { config, keysFromEnv };
}

export function getBaseUrl() {
  return process.env.AEROLINK_BASE_URL || 'https://capi.aerolink.lat';
}

export function getModel() {
  return process.env.AEROLINK_MODEL || 'claude-sonnet-4-6';
}

export function getProxyPort() {
  return parseInt(process.env.PROXY_PORT || '3000', 10);
}
