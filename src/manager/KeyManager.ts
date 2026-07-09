import { Mutex } from 'async-mutex';
import { EventEmitter } from 'events';
import { ApiKey, ManagerConfig, StorageInterface, KeyStats, KeyStatus, TestResult } from './types.js';
import { logger } from '../utils/logger.js';
import { db } from '../storage/Database.js';
import { telegramNotifier } from '../notifier/TelegramNotifier.js';

export class KeyManager extends EventEmitter {
  private keys: Map<string, ApiKey> = new Map();
  private storage: StorageInterface;
  private config: ManagerConfig;
  private mutex = new Mutex();
  private initialized = false;
  private startedAt = Date.now();
  private cooldownCheckInterval: NodeJS.Timeout | null = null;
  
  // Track consecutive upstream errors (e.g., 503 Service Unavailable)
  private consecutiveUpstreamErrors = 0;

  constructor(storage: StorageInterface, config: ManagerConfig, options: { skipShutdownHandlers?: boolean } = {}) {
    super();
    this.storage = storage;
    this.config = config;
    if (!options.skipShutdownHandlers) {
      this.setupGracefulShutdown();
    }
  }

  private setKeyStatus(key: ApiKey, newStatus: KeyStatus, reason?: string) {
    if (key.status === newStatus) return;
    const oldStatus = key.status;
    key.status = newStatus;
    
    // Fire event and log to DB (fire-and-forget for DB to avoid blocking)
    this.emit('keyStatusChanged', { keyId: key.id, oldStatus, newStatus, reason });
    try {
      db.insertKeyEvent({
        key_id: key.id,
        old_status: oldStatus,
        new_status: newStatus,
        reason,
        timestamp: Date.now()
      });
    } catch (err) {
      logger.error(`Failed to log key event: ${err}`);
    }
  }

  public async init(initialKeys: Partial<ApiKey>[] = []) {
    const savedKeys = await this.storage.loadKeys();
    
    // Merge saved keys with initial/env keys
    const mergedKeys = new Map<string, ApiKey>();
    
    for (const key of savedKeys) {
      mergedKeys.set(key.id, key);
    }

    for (const initKey of initialKeys) {
      if (!mergedKeys.has(initKey.id!)) {
        mergedKeys.set(initKey.id!, {
          id: initKey.id!,
          apiKey: initKey.apiKey!,
          status: initKey.status || 'available',
          cooldownUntil: initKey.cooldownUntil || null,
          lastUsed: initKey.lastUsed || null,
          requests: initKey.requests || 0,
          successes: initKey.successes || 0,
          failures: initKey.failures || 0,
          rateLimitHits: initKey.rateLimitHits || 0,
          totalLatencyMs: initKey.totalLatencyMs || 0,
          inputTokens: initKey.inputTokens || 0,
          outputTokens: initKey.outputTokens || 0
        });
      } else {
        // Update the actual key string in case it changed in env
        const existing = mergedKeys.get(initKey.id!)!;
        existing.apiKey = initKey.apiKey!;
      }
    }

    this.keys = mergedKeys;
    this.releaseExpiredKeys();
    this.initialized = true;

    // Actively check for expired cooldowns every 1 second
    this.cooldownCheckInterval = setInterval(() => {
      this.releaseExpiredKeys();
    }, 1000);

    logger.info(`KeyManager initialized with ${this.keys.size} keys.`);
  }

  public releaseExpiredKeys() {
    const now = Date.now();
    for (const key of this.keys.values()) {
      if ((key.status === 'cooling' || key.status === 'busy') && key.cooldownUntil && now >= key.cooldownUntil) {
        this.setKeyStatus(key, 'available', 'cooldown/quota expired');
        key.cooldownUntil = null;
        logger.info(`Key ${key.id} released from cooldown/quota limit.`);
      }
    }
  }

  public getStats(): KeyStats[] {
    return Array.from(this.keys.values()).map(k => {
      const { apiKey, ...rest } = k;
      const averageLatency = k.successes > 0 ? k.totalLatencyMs / k.successes : 0;
      return { ...rest, averageLatency, inputTokens: k.inputTokens || 0, outputTokens: k.outputTokens || 0 };
    });
  }

  public async updateTokenUsage(keyId: string, inputTokens: number, outputTokens: number) {
    const key = this.keys.get(keyId);
    if (!key) return;
    key.inputTokens = (key.inputTokens || 0) + inputTokens;
    key.outputTokens = (key.outputTokens || 0) + outputTokens;
    await this.storage.saveKeys(Array.from(this.keys.values()));
  }

  public getUptime(): number {
    return Date.now() - this.startedAt;
  }

  public getUpstreamStatus(): 'operational' | 'degraded' | 'offline' {
    if (this.consecutiveUpstreamErrors === 0) return 'operational';
    if (this.consecutiveUpstreamErrors < 3) return 'degraded';
    return 'offline';
  }

  public async shutdown() {
    logger.info('Shutting down KeyManager, saving state...');
    if (this.cooldownCheckInterval) {
      clearInterval(this.cooldownCheckInterval);
    }
    await this.storage.saveKeys(Array.from(this.keys.values()));
  }

  private setupGracefulShutdown() {
    const handleExit = async () => {
      try {
        await this.shutdown();
      } catch {}
      process.exit(0);
    };
    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);
  }

  private async acquireKey(): Promise<ApiKey> {
    return await this.mutex.runExclusive(() => {
      this.releaseExpiredKeys();

      const availableKeys = Array.from(this.keys.values()).filter(k => k.status === 'available');

      if (availableKeys.length === 0) {
        // If all keys are cooling, find the one that expires first
        const coolingKeys = Array.from(this.keys.values()).filter(k => k.status === 'cooling');
        if (coolingKeys.length > 0) {
          const earliest = coolingKeys.reduce((prev, curr) => 
            (prev.cooldownUntil || 0) < (curr.cooldownUntil || 0) ? prev : curr
          );
          const err: any = new Error(`All keys are cooling. Next key available at ${new Date(earliest.cooldownUntil!).toISOString()}`);
          err.status = 429;
          const waitSeconds = Math.max(1, Math.ceil((earliest.cooldownUntil! - Date.now()) / 1000));
          err.headers = { 'retry-after': waitSeconds.toString() };
          throw err;
        }
        const err: any = new Error('No keys available (all might be busy or disabled).');
        err.status = 503;
        throw err;
      }

      // Weighted Round Robin: prefer fewer recent requests (approximated by total requests for now)
      availableKeys.sort((a, b) => a.requests - b.requests);
      
      const selectedKey = availableKeys[0];
      this.setKeyStatus(selectedKey, 'busy', 'acquired for request');
      
      return selectedKey;
    });
  }

  public async releaseKey(keyId: string, success: boolean, latencyMs: number) {
    await this.mutex.runExclusive(() => {
      const key = this.keys.get(keyId);
      if (!key) return;

      if (key.status === 'busy') {
        this.setKeyStatus(key, 'available', 'released after request');
      }
      
      key.requests += 1;
      key.lastUsed = Date.now();
      
      if (success) {
        key.successes += 1;
        key.totalLatencyMs += latencyMs;
      } else {
        key.failures += 1;
      }
    });
    
    // Save state opportunistically without blocking execution if possible,
    // or rely on shutdown. To ensure state persists across crashes, save now.
    this.storage.saveKeys(Array.from(this.keys.values())).catch(err => {
      logger.error('Failed to save keys state: ' + err.message);
    });
  }

  public async markRateLimited(keyId: string, resetTimeMs?: number) {
    await this.mutex.runExclusive(() => {
      const key = this.keys.get(keyId);
      if (!key) return;

      this.setKeyStatus(key, 'cooling', 'rate limited');
      key.rateLimitHits += 1;
      key.requests += 1;
      key.failures += 1; // Rate limit counts as a failure
      key.lastUsed = Date.now();
      
      const cooldownUntil = resetTimeMs || (Date.now() + this.config.cooldownDurationMs);
      key.cooldownUntil = cooldownUntil;
      
      logger.warn(`Key ${key.id} rate limited. Cooling until ${new Date(cooldownUntil).toISOString()}`);
    });

    this.storage.saveKeys(Array.from(this.keys.values())).catch(err => {
      logger.error('Failed to save keys state: ' + err.message);
    });
  }

  public async markQuotaExhausted(keyId: string, resetTimeMs?: number) {
    await this.mutex.runExclusive(() => {
      const key = this.keys.get(keyId);
      if (!key) return;

      // Mark as busy for quota exhaustion as requested by user
      this.setKeyStatus(key, 'busy', 'quota exhausted (402)');
      key.requests += 1;
      key.failures += 1; 
      key.lastUsed = Date.now();
      
      // Default to 5 hours if resetTimeMs is not provided
      const cooldownUntil = resetTimeMs || (Date.now() + (5 * 60 * 60 * 1000));
      key.cooldownUntil = cooldownUntil;
      
      logger.warn(`Key ${key.id} quota exhausted. Marked as busy until ${new Date(cooldownUntil).toISOString()}`);
    });

    this.storage.saveKeys(Array.from(this.keys.values())).catch(err => {
      logger.error('Failed to save keys state: ' + err.message);
    });
  }

  public async execute<T>(task: (apiKey: string) => Promise<{ data: T, headers: Headers }>): Promise<T> {
    if (!this.initialized) {
      throw new Error('KeyManager not initialized. Call init() first.');
    }

    let attempt = 0;
    while (attempt < this.config.retryCount) {
      const key = await this.acquireKey();
      const startTime = Date.now();
      
      try {
        const response = await task(key.apiKey);
        const latency = Date.now() - startTime;
        
        // Reset upstream errors on success
        if (this.consecutiveUpstreamErrors > 0) {
          this.consecutiveUpstreamErrors = 0;
          this.emit('keyStatusChanged', { keyId: 'system', oldStatus: 'offline', newStatus: 'operational', reason: 'upstream recovered' });
        }

        await this.releaseKey(key.id, true, latency);
        return response.data;

      } catch (error: any) {
        const latency = Date.now() - startTime;
        
        // Check for Quota Exhaustion / Payment Required (402)
        if (error.status === 402) {
          // Set cooldown to 5 hours
          await this.markQuotaExhausted(key.id, Date.now() + (5 * 60 * 60 * 1000));
          
          logger.warn(`Key ${key.id} exhausted quota. Retrying with next key...`);
          telegramNotifier.alertKeyFailure(key.id, '402 Payment Required (Quota Exhausted)', false);
          // Retry immediately with next key
          continue;
        }

        // Check for 429 Rate Limit
        if (error.status === 429) {
          // Attempt to parse rate limit reset header if available
          let resetTimeMs: number | undefined;
          if (error.headers) {
            const resetHeader = error.headers['x-ratelimit-reset'] || error.headers['retry-after'];
            if (resetHeader) {
              const resetSecs = parseInt(resetHeader, 10);
              if (!isNaN(resetSecs)) {
                // Some APIs return unix timestamp, some return seconds to wait
                if (resetSecs > 1e9) {
                  resetTimeMs = resetSecs * 1000;
                } else {
                  resetTimeMs = Date.now() + (resetSecs * 1000);
                }
              }
            }
          }
          await this.markRateLimited(key.id, resetTimeMs);
          
          logger.warn(`Key ${key.id} rate limited. Retrying with next key...`);
          telegramNotifier.alertKeyFailure(key.id, '429 Too Many Requests', true);
          // Retry immediately with next key
          continue; 
        }

        // Handle Invalid Key / Authentication errors (401)
        if (error.status === 401) {
          logger.warn(`Authentication failed for key ${key.id}. Putting into cooldown instead of disabling.`);
          // Put it in cooldown (e.g., 5 minutes) since it's a 401, the user might refill credits
          await this.markRateLimited(key.id, Date.now() + (5 * 60 * 1000));
          
          logger.warn(`Key ${key.id} unauthorized. Retrying with next key...`);
          telegramNotifier.alertKeyFailure(key.id, '401 Unauthorized', false);
          // Retry immediately with next key
          continue;
        }

        // Handle Transient Network errors (500, 502, 503, 504)
        if (!error.status || error.status >= 500) {
          this.consecutiveUpstreamErrors++;
          if (this.consecutiveUpstreamErrors === 3) {
            this.emit('keyStatusChanged', { keyId: 'system', oldStatus: 'operational', newStatus: 'offline', reason: 'upstream is down' });
          }
          
          await this.releaseKey(key.id, false, latency);
          
          attempt++;
          if (attempt >= this.config.retryCount) {
            throw new Error(`Failed after ${this.config.retryCount} attempts. Last error: ${error.message}`);
          }
          
          // Exponential backoff with jitter for transient errors
          const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 10000);
          logger.warn(`Transient error on key ${key.id}: ${error.message}. Retrying in ${Math.round(delay)}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // Other errors (e.g., 400 Bad Request), fail immediately
        await this.releaseKey(key.id, false, latency);
        throw error;
      }
    }

    throw new Error('Unexpected execution end.');
  }

  public getRawKeys() {
    return Array.from(this.keys.values());
  }

  public async disableKey(keyId: string) {
    await this.mutex.runExclusive(() => {
      const key = this.keys.get(keyId);
      if (!key) return;
      this.setKeyStatus(key, 'disabled', 'disabled manually or via auth failure');
      logger.warn(`Key ${key.id} has been disabled.`);
    });
    this.storage.saveKeys(Array.from(this.keys.values())).catch(() => {});
  }

  public async enableKey(keyId: string) {
    await this.mutex.runExclusive(() => {
      const key = this.keys.get(keyId);
      if (!key) return;
      key.cooldownUntil = null;
      this.setKeyStatus(key, 'available', 're-enabled manually');
      logger.info(`Key ${key.id} has been re-enabled.`);
    });
    this.storage.saveKeys(Array.from(this.keys.values())).catch(() => {});
  }

  public getKeyIdByApiKey(apiKey: string): string | undefined {
    for (const [id, key] of this.keys.entries()) {
      if (key.apiKey === apiKey) return id;
    }
    return undefined;
  }

  public async addKey(id: string, apiKey: string): Promise<void> {
    if (this.keys.has(id)) {
      throw new Error(`Key with ID "${id}" already exists.`);
    }
    const newKey: ApiKey = {
      id,
      apiKey,
      status: 'available',
      cooldownUntil: null,
      lastUsed: null,
      requests: 0,
      successes: 0,
      failures: 0,
      rateLimitHits: 0,
      totalLatencyMs: 0,
      inputTokens: 0,
      outputTokens: 0
    };
    this.keys.set(id, newKey);
    await this.storage.saveKeys(Array.from(this.keys.values()));
    this.emit('keyStatusChanged', { keyId: id, oldStatus: null, newStatus: 'available', reason: 'key added' });
    logger.info(`Key ${id} added to pool.`);
  }

  public async removeKey(id: string): Promise<void> {
    if (!this.keys.has(id)) {
      throw new Error(`Key with ID "${id}" not found.`);
    }
    this.keys.delete(id);
    await this.storage.saveKeys(Array.from(this.keys.values()));
    this.emit('keyStatusChanged', { keyId: id, oldStatus: 'available', newStatus: null, reason: 'key removed' });
    logger.info(`Key ${id} removed from pool.`);
  }

  public async testAllKeys(): Promise<{ summary: { total: number, working: number, failed: number }, results: TestResult[] }> {
    const keys = this.getRawKeys();
    const upstreamBaseUrl = (process.env.AEROLINK_BASE_URL || 'https://capi.aerolink.lat').replace(/\/$/, '');
    
    const results: TestResult[] = [];

    // Test keys sequentially to avoid flooding the provider
    for (const key of keys) {
      const start = Date.now();
      try {
        const response = await fetch(`${upstreamBaseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key.apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: process.env.AEROLINK_MODEL || 'claude-sonnet-4-6',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 5
          }),
          signal: AbortSignal.timeout(15000)
        });

        const latencyMs = Date.now() - start;
        
        if (response.ok) {
          await response.text();
          results.push({
            id: key.id,
            apiKey: key.apiKey.slice(0, 8) + '...' + key.apiKey.slice(-4),
            status: 'ok',
            httpStatus: response.status,
            message: 'Key is working',
            latencyMs
          });
        } else {
          let errorMsg = `HTTP ${response.status}`;
          try {
            const errBody = await response.text();
            const parsed = JSON.parse(errBody);
            errorMsg = parsed?.error?.message || parsed?.error || errBody;
          } catch { 
            // use default error msg
          }
          results.push({
            id: key.id,
            apiKey: key.apiKey.slice(0, 8) + '...' + key.apiKey.slice(-4),
            status: 'error',
            httpStatus: response.status,
            message: String(errorMsg).slice(0, 200),
            latencyMs
          });
        }
      } catch (err: any) {
        const latencyMs = Date.now() - start;
        results.push({
          id: key.id,
          apiKey: key.apiKey.slice(0, 8) + '...' + key.apiKey.slice(-4),
          status: 'error',
          message: err.message || 'Network error',
          latencyMs
        });
      }
    }

    const working = results.filter(r => r.status === 'ok').length;
    const failed = results.filter(r => r.status === 'error').length;
    
    return {
      summary: { total: results.length, working, failed },
      results
    };
  }
}
