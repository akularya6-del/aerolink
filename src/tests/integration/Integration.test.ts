import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadEnvConfig, getBaseUrl, getModel } from '../../config/env.js';
import { KeyManager } from '../../manager/KeyManager.js';
import { FileStorage } from '../../storage/FileStorage.js';
import { AerolinkClient } from '../../providers/AerolinkClient.js';
import fs from 'fs/promises';

const shouldRun = process.env.RUN_INTEGRATION_TEST === 'true';

describe.runIf(shouldRun)('Integration Test — Live Aerolink API', () => {
  let manager: KeyManager;
  let client: AerolinkClient;
  const testStorageFile = 'test-integration-keys.json';

  beforeAll(async () => {
    const { config, keysFromEnv } = loadEnvConfig();
    const storage = new FileStorage(testStorageFile);
    manager = new KeyManager(storage, config);
    await manager.init(keysFromEnv);
    client = new AerolinkClient(manager, getBaseUrl(), getModel());
  });

  afterAll(async () => {
    await manager.shutdown();
    await fs.unlink(testStorageFile).catch(() => {});
  });

  it('should successfully make a real API request and stop immediately', async () => {
    if (manager.getRawKeys().length === 0) {
      console.warn('No keys found in environment. Skipping integration test.');
      return;
    }

    // Send a minimal prompt to minimize credit usage
    const response = await client.messages({
      messages: [{ role: 'user', content: 'Reply only with: OK' }],
      max_tokens: 5,
    });

    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.role).toBe('assistant');

    const text = response.content.find(b => b.type === 'text')?.text || '';
    console.log('Integration Test Response:', text);
  }, 30000);
});
