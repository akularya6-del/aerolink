import { describe, it, expect, beforeEach } from 'vitest';
import { KeyManager } from '../../manager/KeyManager.js';
import { MemoryStorage } from '../../storage/MemoryStorage.js';
import { ManagerConfig, ApiKey } from '../../manager/types.js';

describe('KeyManager Unit Tests', () => {
  let storage: MemoryStorage;
  let manager: KeyManager;
  const config: ManagerConfig = {
    cooldownDurationMs: 5000,
    retryCount: 3,
    requestTimeoutMs: 1000,
    maxConcurrentRequests: 10,
    logLevel: 'error',
  };

  const initialKeys: Partial<ApiKey>[] = [
    { id: 'key1', apiKey: 'val1' },
    { id: 'key2', apiKey: 'val2' },
  ];

  beforeEach(async () => {
    storage = new MemoryStorage([]);
    manager = new KeyManager(storage, config, { skipShutdownHandlers: true });
    await manager.init(initialKeys);
  });

  it('should initialize correctly with keys', () => {
    const stats = manager.getStats();
    expect(stats.length).toBe(2);
    expect(stats[0].id).toBe('key1');
    expect(stats[1].id).toBe('key2');
  });

  it('should rotate keys using round robin based on usage', async () => {
    const keysUsed: string[] = [];

    // Use a key 3 times
    for (let i = 0; i < 3; i++) {
      await manager.execute(async (apiKey) => {
        keysUsed.push(apiKey);
        return { data: 'ok', headers: new Headers() };
      });
    }

    // Should be val1, val2, val1 because they start at 0 usage
    // WRR picks the one with lowest requests.
    expect(keysUsed[0]).toBe('val1');
    expect(keysUsed[1]).toBe('val2');
    expect(keysUsed[2]).toBe('val1');
  });

  it('should handle concurrency safely', async () => {
    const activeKeys = new Set<string>();
    
    const task = async () => {
      return manager.execute(async (apiKey) => {
        expect(activeKeys.has(apiKey)).toBe(false);
        activeKeys.add(apiKey);
        // simulate async work
        await new Promise(r => setTimeout(r, 50));
        activeKeys.delete(apiKey);
        return { data: 'ok', headers: new Headers() };
      });
    };

    // Run 4 tasks concurrently, we only have 2 keys.
    // The execution should not assign the same key to two concurrent tasks
    // Wait, the KeyManager marks a key as 'busy' inside the mutex.
    // If a key is 'busy', it's NOT 'available', so it can't be picked.
    // If 4 tasks run, the first 2 get key1 and key2.
    // The next 2 will throw an Error because no keys are available.
    // Let's test that exactly 2 succeed and 2 fail.
    
    const results = await Promise.allSettled([task(), task(), task(), task()]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    
    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(2);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('No keys available');
  });

  it('should mark key as cooling on 429 rate limit', async () => {
    try {
      await manager.execute(async (apiKey) => {
        if (apiKey === 'val1') {
          throw { status: 429, message: 'Rate limited' };
        }
        return { data: 'ok', headers: new Headers() };
      });
    } catch (e) {
      // The KeyManager will retry with key2 because it caught 429 on key1!
    }

    const rawKeys = manager.getRawKeys();
    const key1 = rawKeys.find(k => k.id === 'key1');
    const key2 = rawKeys.find(k => k.id === 'key2');

    expect(key1?.status).toBe('cooling');
    expect(key1?.failures).toBe(1);
    expect(key1?.rateLimitHits).toBe(1);

    expect(key2?.status).toBe('available');
    expect(key2?.successes).toBe(1);
  });

  it('should retry on transient error (500) and exponential backoff', async () => {
    const startTime = Date.now();
    let attempts = 0;
    try {
      await manager.execute(async (apiKey) => {
        attempts++;
        throw { status: 500, message: 'Internal error' };
      });
    } catch (e: any) {
      expect(e.message).toContain('Failed after 3 attempts');
    }
    const duration = Date.now() - startTime;
    
    // Attempt 1 fails -> delay ~1000ms
    // Attempt 2 fails -> delay ~2000ms
    // Attempt 3 fails -> throws
    // Total delay ~ 3000ms minimum
    expect(attempts).toBe(3);
    expect(duration).toBeGreaterThanOrEqual(3000);
  }, 15000);
});
