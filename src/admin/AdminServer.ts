import express from 'express';
import cors from 'cors';
import { KeyManager } from '../manager/KeyManager.js';
import { db } from '../storage/Database.js';
import { telegramNotifier } from '../notifier/TelegramNotifier.js';
import path from 'path';
import { logger } from '../utils/logger.js';
import { eventBus } from '../utils/events.js';
import http from 'http';

export class AdminServer {
  private app: express.Application;
  private server?: http.Server;
  private keyManager: KeyManager;
  private port: number;

  // SSE clients
  private clients: Set<express.Response> = new Set();

  constructor(keyManager: KeyManager, port: number = 3001) {
    this.keyManager = keyManager;
    this.port = port;
    this.app = express();

    this.app.use(cors());
    this.app.use(express.json());

    this.setupRoutes();
    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Forward KeyManager events to SSE clients
    this.keyManager.on('keyStatusChanged', (event) => {
      this.broadcastEvent('key_status_changed', event);
    });

    eventBus.on('proxy_request', (event) => {
      this.broadcastEvent('proxy_request', event);
    });

    eventBus.on('proxy_error', (event) => {
      this.broadcastEvent('proxy_error', event);
    });

    // Also collect health metrics periodically
    setInterval(() => {
      const usage = process.memoryUsage();
      this.broadcastEvent('health_update', {
        uptime: process.uptime(),
        memory: {
          rss: usage.rss,
          heapTotal: usage.heapTotal,
          heapUsed: usage.heapUsed
        },
        cpu: process.cpuUsage()
      });
    }, 5000);
  }

  private broadcastEvent(type: string, data: any) {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch (err) {
        this.clients.delete(client);
      }
    }
  }

  // Hook to manually emit an event (e.g. from ProxyServer)
  public emitProxyEvent(type: string, data: any) {
    this.broadcastEvent(type, data);
  }

  private setupRoutes() {
    this.app.get('/api/stats', (req, res) => {
      const stats = this.keyManager.getStats();
      const tokenStats = db.getTotalTokens();
      res.json({
        total: stats.length,
        available: stats.filter(k => k.status === 'available').length,
        busy: stats.filter(k => k.status === 'busy').length,
        cooling: stats.filter(k => k.status === 'cooling').length,
        disabled: stats.filter(k => k.status === 'disabled').length,
        totalInputTokens: tokenStats.input,
        totalOutputTokens: tokenStats.output,
        upstreamStatus: this.keyManager.getUpstreamStatus()
      });
    });

    this.app.get('/api/keys', (req, res) => {
      // Redact full API keys before sending to dashboard
      const keys = this.keyManager.getRawKeys().map(k => ({
        ...k,
        apiKey: k.apiKey.slice(0, 8) + '...' + k.apiKey.slice(-4)
      }));
      res.json(keys);
    });

    this.app.get('/api/logs', (req, res) => {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const logs = db.getRecentRequests(limit, offset);
      res.json(logs);
    });

    this.app.get('/api/errors', (req, res) => {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const errors = db.getRecentErrors(limit, offset);
      res.json(errors);
    });

    this.app.get('/api/key-timeline/:id', (req, res) => {
      const timeline = db.getKeyTimeline(req.params.id);
      res.json(timeline);
    });

    this.app.get('/api/analytics/requests', (req, res) => {
      // Last 24 hours
      const data = db.getRequestsOverTime(24 * 60 * 60 * 1000);
      res.json(data);
    });

    this.app.get('/api/analytics/models', (req, res) => {
      res.json(db.getModelUsage());
    });

    this.app.get('/api/analytics/errors', (req, res) => {
      res.json(db.getErrorDistribution());
    });

    // Test all keys against the upstream API
    this.app.post('/api/test-keys', async (req, res) => {
      const { summary, results } = await this.keyManager.testAllKeys();
      
      // Fire and forget telegram alert
      telegramNotifier.alertTestResults(summary.working, summary.failed, results).catch(err => {
        console.error('Failed to send telegram test results alert:', err.message);
      });
      
      res.json({
        testedAt: new Date().toISOString(),
        summary,
        results
      });
    });

    // Add a new API key at runtime
    this.app.post('/api/keys', async (req, res) => {
      const { id, apiKey } = req.body;
      if (!id || !apiKey) {
        res.status(400).json({ error: 'Both "id" and "apiKey" are required.' });
        return;
      }
      try {
        await this.keyManager.addKey(id.trim(), apiKey.trim());
        res.json({ success: true, message: `Key "${id}" added successfully.` });
      } catch (err: any) {
        res.status(409).json({ error: err.message });
      }
    });

    // Remove a key at runtime
    this.app.delete('/api/keys/:id', async (req, res) => {
      try {
        await this.keyManager.removeKey(req.params.id);
        res.json({ success: true, message: `Key "${req.params.id}" removed successfully.` });
      } catch (err: any) {
        res.status(404).json({ error: err.message });
      }
    });

    // Disable a key
    this.app.patch('/api/keys/:id/disable', async (req, res) => {
      try {
        await this.keyManager.disableKey(req.params.id);
        res.json({ success: true, message: `Key "${req.params.id}" disabled.` });
      } catch (err: any) {
        res.status(404).json({ error: err.message });
      }
    });

    // Re-enable a key
    this.app.patch('/api/keys/:id/enable', async (req, res) => {
      try {
        await this.keyManager.enableKey(req.params.id);
        res.json({ success: true, message: `Key "${req.params.id}" re-enabled.` });
      } catch (err: any) {
        res.status(404).json({ error: err.message });
      }
    });

    this.app.get('/api/events', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Send initial connection event
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

      this.clients.add(res);

      req.on('close', () => {
        this.clients.delete(res);
      });
    });

    // Serve the Next.js dashboard static export from the / root
    const dashboardOutPath = path.join(process.cwd(), 'dashboard', 'out');
    this.app.use(express.static(dashboardOutPath));
    
    // Fallback all other routes to Next.js index.html (for client-side routing)
    this.app.use((req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(dashboardOutPath, 'index.html'));
    });
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`Admin API Server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
    
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
