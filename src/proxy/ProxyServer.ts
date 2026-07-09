import http from 'http';
import { KeyManager } from '../manager/KeyManager.js';
import { logger } from '../utils/logger.js';
import { db } from '../storage/Database.js';
import picocolors from 'picocolors';
import { eventBus } from '../utils/events.js';

// Headers to not forward upstream (hop-by-hop)
const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
  'host',
]);

export interface ProxyServerOptions {
  port: number;
  upstreamBaseUrl: string;
}

export class ProxyServer {
  private server: http.Server;
  private keyManager: KeyManager;
  private upstreamBaseUrl: string;
  private port: number;
  private requestCount = 0;

  constructor(keyManager: KeyManager, options: ProxyServerOptions) {
    this.keyManager = keyManager;
    this.upstreamBaseUrl = options.upstreamBaseUrl.replace(/\/$/, '');
    this.port = options.port;
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const requestId = ++this.requestCount;
    const startTime = Date.now();
    const method = req.method || 'GET';
    const path = req.url || '/';

    logger.info(`[Req ${requestId}] ${method} ${path}`);
    logger.info(`[Req ${requestId}] Client Headers: ${JSON.stringify(req.headers)}`);

    // Handle health check
    if (path === '/health' || path === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const stats = this.keyManager.getStats();
      res.end(JSON.stringify({
        status: 'ok',
        keys: stats.length,
        available: stats.filter(s => s.status === 'available').length,
        cooling: stats.filter(s => s.status === 'cooling').length,
        busy: stats.filter(s => s.status === 'busy').length,
        uptime: this.keyManager.getUptime(),
      }));
      return;
    }

    // Only allow API requests
    if (!path.startsWith('/v1/')) {
      logger.warn(`[Req ${requestId}] Rejected non-API path: ${path}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found', message: 'Only /v1/ paths are supported by this proxy' }));
      return;
    }

    // Read request body using explicit event listeners (more reliable in test environments)
    const bodyBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

    // Detect streaming from body
    let isStreaming = false;
    try {
      const bodyJson = JSON.parse(bodyBuffer.toString());
      isStreaming = bodyJson.stream === true;
    } catch {
      // not JSON, not streaming
    }

    // Acquire key and execute request
    let acquiredKeyId: string | null = null;
    let retries = 0;
    const maxRetries = 5;

    const tryRequest = async (): Promise<void> => {
      // Get an available key from the manager
      let selectedKey: string;
      try {
        selectedKey = await this.getNextKey();
        acquiredKeyId = null; // We track through execute
      } catch (err: any) {
        logger.error(`[Req ${requestId}] No keys available: ${err.message}`);
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          type: 'error',
          error: { type: 'rate_limit_error', message: 'All API keys are in cooldown. ' + err.message }
        }));
        return;
      }

      try {
        await this.keyManager.execute(async (apiKey) => {
          acquiredKeyId = apiKey;
          logger.info(`[Req ${requestId}] Using key: ${this.maskKey(apiKey)}`);

          // Build upstream headers
          const upstreamHeaders: Record<string, string> = {};
          
          for (const [k, v] of Object.entries(req.headers)) {
            const lower = k.toLowerCase();
            if (HOP_BY_HOP_HEADERS.has(lower)) continue;
            if (lower === 'host') continue;
            if (lower === 'authorization' || lower === 'x-api-key') continue;
            if (typeof v === 'string') upstreamHeaders[lower] = v;
            else if (Array.isArray(v)) upstreamHeaders[lower] = v[0];
          }

          // Inject the pool key as both x-api-key and Authorization (Aerolink paid tier verification)
          upstreamHeaders['x-api-key'] = apiKey;
          upstreamHeaders['authorization'] = `Bearer ${apiKey}`;
          upstreamHeaders['content-length'] = bodyBuffer.length.toString();

          const upstreamUrl = `${this.upstreamBaseUrl}${path}`;
          logger.debug(`[Req ${requestId}] → ${upstreamUrl}`);

      const abortController = new AbortController();
      req.on('close', () => {
        if (!res.writableEnded) {
          logger.warn(`[Req ${requestId}] Client disconnected prematurely.`);
          abortController.abort();
        }
      });

      const upstreamRes = await fetch(upstreamUrl, {
          method,
          headers: upstreamHeaders,
          body: bodyBuffer.length > 0 ? new Uint8Array(bodyBuffer) : undefined,
          signal: abortController.signal
        });

        const responseHeaders: Record<string, string> = {};

          upstreamRes.headers.forEach((v, k) => {
            if (!HOP_BY_HOP_HEADERS.has(k.toLowerCase())) {
              responseHeaders[k] = v;
            }
          });

          if (!upstreamRes.ok) {
            // Read the error body completely so we can forward it
            const errorBuffer = await upstreamRes.arrayBuffer();
            const errorBody = Buffer.from(errorBuffer).toString('utf8');
            
            logger.error(`[Req ${requestId}] Upstream returned ${upstreamRes.status}. Body: ${errorBody}`);
            
            let parsed: any = {};
            try { parsed = JSON.parse(errorBody); } catch (e) {}

            const isRateLimit = upstreamRes.status === 429;
            const isAuthError = upstreamRes.status === 401;
            const isQueueFull = isAuthError && typeof parsed?.error === 'string' && parsed?.error?.includes('Priority queue full');

            if (isRateLimit || (parsed?.error?.type === 'rate_limit_error') || isQueueFull) {
              const err: any = new Error('Rate limited / Queue full');
              err.status = 429;
              err.errorBody = JSON.stringify({
                type: 'error',
                error: { type: 'rate_limit_error', message: 'Priority queue full or rate limit exceeded' }
              });
              let resetHeader = upstreamRes.headers.get('x-ratelimit-reset') || upstreamRes.headers.get('retry-after');
              if (isQueueFull) resetHeader = '10';
              if (resetHeader) err.headers = { 'x-ratelimit-reset': resetHeader };
              throw err;
            }

            if (isAuthError) {
              logger.error(`[Req ${requestId}] 401 Unauthorized from upstream. Body: ${errorBody}`);
              const err: any = new Error('Authentication failed');
              err.status = 401;
              err.errorBody = errorBody;
              throw err;
            }

            const err: any = new Error(`Upstream error ${upstreamRes.status}`);
            err.status = upstreamRes.status;
            err.errorBody = errorBody;
            throw err;
          }

          const elapsed = Date.now() - startTime;
          logger.info(picocolors.green(`[Req ${requestId}] ✓ ${upstreamRes.status} in ${elapsed}ms`));

          // Stream response back to Claude Code
          res.writeHead(upstreamRes.status, responseHeaders);

          let inputTokens = 0;
          let outputTokens = 0;
          let modelName = '';

          if (isStreaming && upstreamRes.body) {
            const reader = upstreamRes.body.getReader();
            let chunkBuffer = '';
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);

                // Parse tokens from stream
                const str = Buffer.from(value).toString('utf-8');
                chunkBuffer += str;

                if (!modelName) {
                  const mModel = chunkBuffer.match(/"model"\s*:\s*"([^"]+)"/);
                  if (mModel) modelName = mModel[1];
                }
                const mInput = str.match(/"input_tokens"\s*:\s*(\d+)/g);
                if (mInput) {
                  for (const match of mInput) {
                    const val = parseInt(match.match(/\d+/)![0]);
                    if (val > inputTokens) inputTokens = val;
                  }
                }
                const mOutput = str.match(/"output_tokens"\s*:\s*(\d+)/g);
                if (mOutput) {
                  for (const match of mOutput) {
                    const val = parseInt(match.match(/\d+/)![0]);
                    if (val > outputTokens) outputTokens = val;
                  }
                }

                if (chunkBuffer.length > 4096) {
                  chunkBuffer = chunkBuffer.slice(-2048);
                }
              }
            } finally {
              reader.releaseLock();
            }
            res.end();
          } else {
            const data = await upstreamRes.arrayBuffer();
            const bodyStr = Buffer.from(data).toString('utf-8');
            try {
              const parsed = JSON.parse(bodyStr);
              if (parsed.model) modelName = parsed.model;
              if (parsed.usage) {
                inputTokens = parsed.usage.input_tokens || 0;
                outputTokens = parsed.usage.output_tokens || 0;
              }
            } catch (e) {}
            res.end(Buffer.from(data));
          }

          // Log to DB and KeyManager after request finishes
          const keyId = this.keyManager.getKeyIdByApiKey(apiKey) || 'unknown';
          try {
            if (inputTokens > 0 || outputTokens > 0) {
              this.keyManager.updateTokenUsage(keyId, inputTokens, outputTokens).catch(e => logger.error('Failed to update tokens:', e));
            }
            db.insertRequest({
              key_id: keyId,
              endpoint: path,
              latency_ms: elapsed, // upstream latency
              status_code: upstreamRes.status,
              success: true,
              retries,
              duration_ms: elapsed, // total duration is same as latency for now
              timestamp: startTime,
              model: modelName || undefined,
              input_tokens: inputTokens,
              output_tokens: outputTokens
            });
            eventBus.emit('proxy_request', {
              key_id: keyId, endpoint: path, latency_ms: elapsed, status_code: upstreamRes.status, success: true, timestamp: startTime
            });
          } catch (e) {
            logger.error(`Failed to log request: ${e}`);
          }

          // Return fake response for KeyManager's type requirement
          return { data: { error: 'forwarded' }, headers: upstreamRes.headers };
        });
      } catch (err: any) {
        if (res.headersSent) return;

        // If still retrying transients
        if (retries < maxRetries && err.status && err.status >= 500) {
          retries++;
          logger.warn(`[Req ${requestId}] Retrying (${retries}/${maxRetries}) after: ${err.message}`);
          const delay = Math.min(500 * Math.pow(2, retries) + Math.random() * 500, 8000);
          await new Promise(r => setTimeout(r, delay));
          return tryRequest();
        }

        logger.error(`[Req ${requestId}] Failed: ${err.message}`);
        
        // Log Error to DB
        const keyId = acquiredKeyId ? (this.keyManager.getKeyIdByApiKey(acquiredKeyId) || 'unknown') : 'unknown';
        try {
          db.insertError({
            key_id: keyId,
            request_id: requestId,
            error_message: err.message,
            stack_trace: err.stack,
            timestamp: Date.now()
          });
          db.insertRequest({
            key_id: keyId,
            endpoint: path,
            latency_ms: Date.now() - startTime,
            status_code: err.status || 500,
            success: false,
            retries,
            duration_ms: Date.now() - startTime,
            timestamp: startTime
          });
          eventBus.emit('proxy_error', {
            key_id: keyId, error_message: err.message, status_code: err.status || 500, timestamp: Date.now()
          });
        } catch (e) {
          logger.error(`Failed to log error: ${e}`);
        }
        
        if (err.errorBody) {
          // Transparently forward the exact error response to the client
          const headers = { 'Content-Type': 'application/json', ...err.headers };
          res.writeHead(err.status || 500, headers);
          res.end(err.errorBody);
        } else {
          // Fallback Anthropic format
          const headers = { 'Content-Type': 'application/json', ...err.headers };
          res.writeHead(err.status || 500, headers);
          
          let errorType = 'api_error';
          if (err.status === 429) errorType = 'rate_limit_error';
          if (err.status === 401) errorType = 'authentication_error';
          
          res.end(JSON.stringify({
            type: 'error',
            error: { 
              type: errorType, 
              message: err.message 
            }
          }));
        }
      }
    };

    await tryRequest();
  }

  private async getNextKey(): Promise<string> {
    // We peek at the raw keys to find an available one (just for checking)
    const raw = this.keyManager.getRawKeys();
    const available = raw.filter(k => k.status === 'available');
    if (available.length === 0) {
      const cooling = raw.filter(k => k.status === 'cooling');
      if (cooling.length > 0) {
        const earliest = cooling.reduce((a, b) =>
          (a.cooldownUntil || 0) < (b.cooldownUntil || 0) ? a : b
        );
        throw new Error(`All keys cooling. Next available at ${new Date(earliest.cooldownUntil!).toISOString()}`);
      }
      throw new Error('No available keys found');
    }
    return available[0].apiKey;
  }

  private maskKey(key: string): string {
    if (key.length <= 12) return '***';
    return key.slice(0, 12) + '...' + key.slice(-4);
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, '127.0.0.1', () => {
        logger.info(picocolors.bold(picocolors.green(`\n🔑 Aerolink Key Manager Proxy`)));
        logger.info(`   Listening on: ${picocolors.cyan(`http://127.0.0.1:${this.port}`)}`);
        logger.info(`   Upstream:     ${picocolors.cyan(this.upstreamBaseUrl)}`);
        logger.info(`   Keys loaded:  ${picocolors.yellow(String(this.keyManager.getRawKeys().length))}`);
        const stats = this.keyManager.getStats();
        stats.forEach(s => {
          const statusColor = s.status === 'available' ? picocolors.green : 
                              s.status === 'cooling' ? picocolors.yellow : picocolors.red;
          logger.info(`   • ${s.id}: ${statusColor(s.status)}`);
        });
        logger.info('');
        logger.info(picocolors.dim('  Set ANTHROPIC_BASE_URL=http://127.0.0.1:' + this.port + ' in ~/.claude/settings.json'));
        logger.info('');
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
