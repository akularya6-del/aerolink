#!/usr/bin/env node

/**
 * Aerolink Key Manager Proxy — Entry Point
 *
 * Starts a local HTTP server that:
 *  1. Intercepts all Claude Code → Aerolink requests
 *  2. Automatically injects an available API key from the pool
 *  3. Forwards request upstream to https://capi.aerolink.lat/
 *  4. Returns the full response (including streaming) back to Claude Code
 *
 * Usage:
 *   node dist/proxy/start.js
 *   PORT=3000 node dist/proxy/start.js
 */

import dotenv from 'dotenv';
dotenv.config();

import { telegramNotifier } from '../notifier/TelegramNotifier.js';

import { KeyManager } from '../manager/KeyManager.js';
import { FileStorage } from '../storage/FileStorage.js';
import { loadEnvConfig } from '../config/env.js';
import { ProxyServer } from './ProxyServer.js';
import { AdminServer } from '../admin/AdminServer.js';
import { logger } from '../utils/logger.js';

import path from 'path';
const PORT = parseInt(process.env.PROXY_PORT || '3000', 10);
const UPSTREAM_URL = process.env.AEROLINK_BASE_URL || 'https://capi.aerolink.lat';
const STATE_FILE = process.env.STATE_FILE || path.join(process.cwd(), 'keys-state.json');

async function main() {
  const { config, keysFromEnv } = loadEnvConfig();
  logger.setLevel(config.logLevel);

  if (keysFromEnv.length === 0) {
    logger.error('No API keys found. Set AEROLINK_KEY_1, AEROLINK_KEY_2, etc. in .env');
    process.exit(1);
  }

  const storage = new FileStorage(STATE_FILE);
  const manager = new KeyManager(storage, config);
  await manager.init(keysFromEnv);
  
  // Initialize Telegram bot with the KeyManager instance for automated checks
  telegramNotifier.init(manager);

  const proxy = new ProxyServer(manager, {
    port: PORT,
    upstreamBaseUrl: UPSTREAM_URL,
  });

  const adminPort = parseInt(process.env.ADMIN_PORT || '3001', 10);
  const adminServer = new AdminServer(manager, adminPort);

  await adminServer.start();
  await proxy.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`\nReceived ${signal}. Shutting down...`);
    await adminServer.stop();
    await proxy.stop();
    await manager.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  logger.error('Failed to start proxy:', err.message);
  process.exit(1);
});
