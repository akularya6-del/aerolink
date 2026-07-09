#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

import { KeyManager } from '../manager/KeyManager.js';
import { MemoryStorage } from '../storage/MemoryStorage.js';
import { loadEnvConfig } from '../config/env.js';
import { telegramNotifier } from '../notifier/TelegramNotifier.js';

async function main() {
  console.log('🚀 Starting Automated Key Tester...');
  
  const { config, keysFromEnv } = loadEnvConfig();
  
  if (keysFromEnv.length === 0) {
    console.error('❌ No API keys found in environment variables.');
    process.exit(1);
  }

  // We use MemoryStorage since this is a one-off run on GitHub Actions.
  // We don't care about persisting cooldowns across 30-min intervals for the test script.
  const storage = new MemoryStorage();
  const manager = new KeyManager(storage, config);
  
  await manager.init(keysFromEnv);
  telegramNotifier.init(manager);

  console.log(`⏳ Testing ${keysFromEnv.length} keys...`);
  
  const { summary, results } = await manager.testAllKeys();
  
  console.log(`✅ Testing complete: ${summary.working} PASS / ${summary.failed} FAIL`);
  
  // Send alert to Telegram (isAutomated = true)
  try {
    await telegramNotifier.alertTestResults(summary.working, summary.failed, results, true);
    console.log('📱 Telegram alert sent successfully.');
  } catch (err: any) {
    console.error(`❌ Failed to send Telegram alert: ${err.message}`);
  }

  // Allow time for pending network requests to complete before exit
  setTimeout(() => process.exit(0), 1000);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
