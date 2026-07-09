import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import { KeyManager } from '../../manager/KeyManager.js';
import { MemoryStorage } from '../../storage/MemoryStorage.js';
import { ProxyServer } from '../../proxy/ProxyServer.js';
import type { ManagerConfig, ApiKey } from '../../manager/types.js';

const BASE_CONFIG: ManagerConfig = {
  cooldownDurationMs: 5000,
  retryCount: 1,
  requestTimeoutMs: 5000,
  maxConcurrentRequests: 10,
  logLevel: 'error',
};

const INITIAL_KEYS: Partial<ApiKey>[] = [
  { id: 'key1', apiKey: 'test-key-1' },
  { id: 'key2', apiKey: 'test-key-2' },
];

const MOCK_MESSAGE = {
  id: 'msg_123',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'OK' }],
  model: 'claude-sonnet-4-6',
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 5, output_tokens: 2 },
};

function makeRequest(
  port: number,
  path: string,
  method: string,
  body?: object,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          'anthropic-version': '2023-06-01',
          'x-api-key': 'caller-key',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString() }));
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  const view = new Uint8Array(ab);
  buf.forEach((b, i) => { view[i] = b; });
  return ab;
}

function mockOkResponse(data: object) {
  const buf = Buffer.from(JSON.stringify(data));
  return {
    ok: true,
    status: 200,
    headers: {
      forEach: (cb: (v: string, k: string) => void) => cb('application/json', 'content-type'),
      get: (_k: string) => null as string | null,
    },
    arrayBuffer: async () => toArrayBuffer(buf),
  };
}

function mockRateLimitResponse() {
  return {
    ok: false,
    status: 429,
    headers: {
      forEach: (cb: (v: string, k: string) => void) => cb('application/json', 'content-type'),
      get: (_k: string) => null as string | null,
    },
    text: async () => JSON.stringify({ error: { type: 'rate_limit_error', message: 'Rate limited' } }),
  };
}

// ── Single server instance for all tests ─────────────────────────────────────
const TEST_PORT = 13003;
let manager: KeyManager;
let proxy: ProxyServer;

describe('ProxyServer', () => {
  beforeAll(async () => {
    manager = new KeyManager(new MemoryStorage([]), BASE_CONFIG, { skipShutdownHandlers: true });
    await manager.init(INITIAL_KEYS);
    proxy = new ProxyServer(manager, { port: TEST_PORT, upstreamBaseUrl: 'https://mock-upstream.invalid' });
    await proxy.start();
  });

  afterAll(async () => {
    await proxy.stop();
  });

  beforeEach(async () => {
    // Reset mocks and key state before each test
    global.fetch = vi.fn();
    const keys = manager.getRawKeys();
    for (const key of keys) {
      key.status = 'available';
      key.cooldownUntil = null;
      key.requests = 0;
      key.successes = 0;
      key.failures = 0;
      key.rateLimitHits = 0;
    }
  });

  // ── Tests ──────────────────────────────────────────────────────────────────

  it('should return 200 on /health with key stats', async () => {
    const res = await makeRequest(TEST_PORT, '/health', 'GET');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.keys).toBe(2);
    expect(body.available).toBe(2);
  });

  it('should forward /v1/messages and inject pool key (not caller key)', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockOkResponse(MOCK_MESSAGE));

    const res = await makeRequest(TEST_PORT, '/v1/messages', 'POST', {
      model: 'claude-sonnet-4-6', max_tokens: 10,
      messages: [{ role: 'user', content: 'Say OK' }],
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).id).toBe('msg_123');

    const fetchCall = (global.fetch as any).mock.calls[0];
    const sentKey = fetchCall[1].headers['x-api-key'];
    expect(['test-key-1', 'test-key-2']).toContain(sentKey);
    expect(sentKey).not.toBe('caller-key');
    expect(fetchCall[1].headers['authorization']).toBeUndefined();
  });

  it('should put key in cooldown on 429 and rotate to next key', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(mockRateLimitResponse())
      .mockResolvedValueOnce(mockOkResponse(MOCK_MESSAGE));

    const res = await makeRequest(TEST_PORT, '/v1/messages', 'POST', {
      model: 'claude-sonnet-4-6', max_tokens: 5,
      messages: [{ role: 'user', content: 'OK' }],
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).id).toBe('msg_123');

    const keys = manager.getRawKeys();
    const coolingKey = keys.find(k => k.status === 'cooling');
    const successKey = keys.find(k => k.successes > 0);
    expect(coolingKey).toBeDefined();
    expect(successKey).toBeDefined();
    expect(coolingKey?.rateLimitHits).toBe(1);
  });

  it('should return 429 error JSON when all keys are cooling', async () => {
    await manager.markRateLimited('key1');
    await manager.markRateLimited('key2');

    const res = await makeRequest(TEST_PORT, '/v1/messages', 'POST', {
      model: 'claude-sonnet-4-6', max_tokens: 5,
      messages: [{ role: 'user', content: 'OK' }],
    });

    expect(res.status).toBe(429);
    const body = JSON.parse(res.body);
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('rate_limit_error');
  });

  it('should not include raw API keys in response body on error', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Connection reset'));

    const res = await makeRequest(TEST_PORT, '/v1/messages', 'POST', {
      model: 'claude-sonnet-4-6', max_tokens: 5,
      messages: [{ role: 'user', content: 'OK' }],
    });

    expect(res.body).not.toContain('test-key-1');
    expect(res.body).not.toContain('test-key-2');
    expect([500, 503]).toContain(res.status);
  });

  it('should stream SSE events back to the client', async () => {
    const sseEvents = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_001"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];

    let eventIdx = 0;
    const mockBody = {
      getReader: () => ({
        read: async () => {
          if (eventIdx >= sseEvents.length) return { done: true, value: undefined };
          const chunk = Buffer.from(sseEvents[eventIdx++]);
          return { done: false, value: chunk };
        },
        releaseLock: vi.fn(),
      }),
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        forEach: (cb: (v: string, k: string) => void) => cb('text/event-stream', 'content-type'),
        get: (_k: string) => null as string | null,
      },
      body: mockBody,
    });

    const res = await makeRequest(TEST_PORT, '/v1/messages', 'POST', {
      model: 'claude-sonnet-4-6', max_tokens: 5, stream: true,
      messages: [{ role: 'user', content: 'OK' }],
    });

    expect(res.status).toBe(200);
    expect(res.body).toContain('message_start');
    expect(res.body).toContain('message_stop');
    expect(res.body).toContain('OK');
  });
});
