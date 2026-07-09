import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';

export interface RequestLog {
  id?: number;
  key_id: string;
  endpoint: string;
  latency_ms: number;
  status_code: number;
  success: boolean;
  retries: number;
  duration_ms: number;
  timestamp: number;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
}

export interface ErrorLog {
  id?: number;
  key_id: string;
  request_id?: number;
  error_message: string;
  stack_trace?: string;
  timestamp: number;
}

export interface KeyEventLog {
  id?: number;
  key_id: string;
  old_status: string;
  new_status: string;
  reason?: string;
  timestamp: number;
}

export class SQLiteDatabase {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const defaultPath = path.join(process.cwd(), 'data');
    if (!fs.existsSync(defaultPath)) {
      fs.mkdirSync(defaultPath, { recursive: true });
    }
    const finalPath = dbPath || path.join(defaultPath, 'metrics.db');
    this.db = new Database(finalPath, {
      verbose: undefined // enable for debugging
    });
    
    // Enable WAL mode for better concurrency performance
    this.db.pragma('journal_mode = WAL');
    
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        status_code INTEGER NOT NULL,
        success BOOLEAN NOT NULL,
        retries INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_requests_key_id ON requests(key_id);
      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);

      CREATE TABLE IF NOT EXISTS errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id TEXT,
        request_id INTEGER,
        error_message TEXT NOT NULL,
        stack_trace TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON errors(timestamp);

      CREATE TABLE IF NOT EXISTS key_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id TEXT NOT NULL,
        old_status TEXT NOT NULL,
        new_status TEXT NOT NULL,
        reason TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_key_events_key_id ON key_events(key_id);
      CREATE INDEX IF NOT EXISTS idx_key_events_timestamp ON key_events(timestamp);
    `);

    // Run migrations safely
    try {
      this.db.exec(`ALTER TABLE requests ADD COLUMN model TEXT`);
      this.db.exec(`ALTER TABLE requests ADD COLUMN input_tokens INTEGER DEFAULT 0`);
      this.db.exec(`ALTER TABLE requests ADD COLUMN output_tokens INTEGER DEFAULT 0`);
    } catch (e: any) {
      // Columns already exist if error is thrown
      if (!e.message.includes('duplicate column name')) {
        logger.warn('Schema migration error: ' + e.message);
      }
    }
  }

  public insertRequest(log: RequestLog): number | bigint {
    const stmt = this.db.prepare(`
      INSERT INTO requests (key_id, endpoint, latency_ms, status_code, success, retries, duration_ms, timestamp, model, input_tokens, output_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      log.key_id, log.endpoint, log.latency_ms, log.status_code, 
      log.success ? 1 : 0, log.retries, log.duration_ms, log.timestamp,
      log.model || null, log.input_tokens || 0, log.output_tokens || 0
    );
    return info.lastInsertRowid;
  }

  public insertError(log: ErrorLog): number | bigint {
    const stmt = this.db.prepare(`
      INSERT INTO errors (key_id, request_id, error_message, stack_trace, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(log.key_id, log.request_id, log.error_message, log.stack_trace, log.timestamp);
    return info.lastInsertRowid;
  }

  public insertKeyEvent(log: KeyEventLog): number | bigint {
    const stmt = this.db.prepare(`
      INSERT INTO key_events (key_id, old_status, new_status, reason, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(log.key_id, log.old_status, log.new_status, log.reason, log.timestamp);
    return info.lastInsertRowid;
  }

  public getRecentRequests(limit = 100, offset = 0) {
    return this.db.prepare('SELECT * FROM requests ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(limit, offset);
  }

  public getRecentErrors(limit = 100, offset = 0) {
    return this.db.prepare('SELECT * FROM errors ORDER BY timestamp DESC LIMIT ? OFFSET ?').all(limit, offset);
  }

  public getKeyTimeline(keyId: string) {
    return this.db.prepare('SELECT * FROM key_events WHERE key_id = ? ORDER BY timestamp DESC LIMIT 500').all(keyId);
  }

  public getRequestsOverTime(timeWindowMs: number) {
    const cutoff = Date.now() - timeWindowMs;
    return this.db.prepare('SELECT timestamp, success, latency_ms FROM requests WHERE timestamp >= ? ORDER BY timestamp ASC').all(cutoff);
  }

  public getTotalTokens() {
    const row: any = this.db.prepare('SELECT SUM(input_tokens) as total_in, SUM(output_tokens) as total_out FROM requests').get();
    return { input: row.total_in || 0, output: row.total_out || 0 };
  }

  public getModelUsage() {
    return this.db.prepare('SELECT model, COUNT(*) as count FROM requests WHERE model IS NOT NULL GROUP BY model ORDER BY count DESC').all();
  }

  public getErrorDistribution() {
    return this.db.prepare('SELECT status_code, COUNT(*) as count FROM requests WHERE success = 0 GROUP BY status_code ORDER BY count DESC').all();
  }
}

export const db = new SQLiteDatabase();
