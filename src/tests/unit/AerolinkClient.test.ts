import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AerolinkClient, ProviderError } from '../../providers/AerolinkClient.js';
import { KeyManager } from '../../manager/KeyManager.js';
import { MemoryStorage } from '../../storage/MemoryStorage.js';

const MOCK_RESPONSE = {
  id: 'msg_mock_123',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'OK' }],
  model: 'claude-sonnet-4-6',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 5, output_tokens: 2 },
};

describe('AerolinkClient Unit Tests', () => {
  let manager: KeyManager;
  let client: AerolinkClient;

  beforeEach(async () => {
    manager = new KeyManager(new MemoryStorage([]), {
      cooldownDurationMs: 5000,
      retryCount: 1,
      requestTimeoutMs: 5000,
      maxConcurrentRequests: 10,
      logLevel: 'error'
    }, { skipShutdownHandlers: true });
    await manager.init([{ id: 'key1', apiKey: 'test-key' }]);
    client = new AerolinkClient(manager, 'https://mock.api', 'claude-sonnet-4-6');

    global.fetch = vi.fn();
  });

  it('should send POST to /v1/messages with x-api-key header', async () => {
    const mockHeaders = { forEach: vi.fn(), get: vi.fn() };
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: mockHeaders,
      json: async () => MOCK_RESPONSE,
    });

    const res = await client.messages({
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(res.id).toBe('msg_mock_123');
    expect(res.role).toBe('assistant');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, opts] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://mock.api/v1/messages');
    expect(opts.headers['x-api-key']).toBe('test-key');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    expect(opts.headers['Content-Type']).toBe('application/json');
    // Should NOT have authorization header  
    expect(opts.headers['authorization']).toBeUndefined();
    expect(opts.headers['Authorization']).toBeUndefined();
  });

  it('should throw ProviderError with message on non-ok response', async () => {
    const mockHeaders = { forEach: vi.fn(), get: vi.fn() };
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: mockHeaders,
      json: async () => ({ error: { type: 'invalid_request_error', message: 'Invalid payload' } })
    });

    await expect(client.messages({ messages: [{ role: 'user', content: 'hello' }] }))
      .rejects.toThrow('Invalid payload');
  });

  it('should cool down key on 429 and retry with next available key', async () => {
    // Add a second key
    const manager2 = new KeyManager(new MemoryStorage([]), {
      cooldownDurationMs: 5000,
      retryCount: 2,
      requestTimeoutMs: 5000,
      maxConcurrentRequests: 10,
      logLevel: 'error'
    }, { skipShutdownHandlers: true });
    await manager2.init([
      { id: 'key1', apiKey: 'test-key-1' },
      { id: 'key2', apiKey: 'test-key-2' },
    ]);
    const client2 = new AerolinkClient(manager2, 'https://mock.api', 'claude-sonnet-4-6');

    const rateLimitHeaders = { forEach: vi.fn(), get: vi.fn().mockReturnValue(null) };
    const successHeaders = { forEach: vi.fn(), get: vi.fn() };

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: rateLimitHeaders,
        json: async () => ({ error: { type: 'rate_limit_error', message: 'Rate limited' } }),
        text: async () => '{"error":{"type":"rate_limit_error","message":"Rate limited"}}',
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: successHeaders,
        json: async () => MOCK_RESPONSE,
      });

    const res = await client2.messages({ messages: [{ role: 'user', content: 'hello' }] });
    expect(res.id).toBe('msg_mock_123');

    // Key 1 should be in cooling
    const raw = manager2.getRawKeys();
    expect(raw.find(k => k.id === 'key1')?.status).toBe('cooling');
    expect(raw.find(k => k.id === 'key2')?.successes).toBe(1);
  });
});
