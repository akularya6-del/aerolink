#!/usr/bin/env node

import { Command } from 'commander';
import { KeyManager } from '../manager/KeyManager.js';
import { FileStorage } from '../storage/FileStorage.js';
import { loadEnvConfig, getBaseUrl, getModel } from '../config/env.js';
import { AerolinkClient } from '../providers/AerolinkClient.js';
import fs from 'fs/promises';
import picocolors from 'picocolors';

const program = new Command();
program
  .name('aerolink-key-manager')
  .description('CLI to manage Aerolink API Keys')
  .version('1.0.0');

const { config, keysFromEnv } = loadEnvConfig();
const storage = new FileStorage('keys-state.json');
const manager = new KeyManager(storage, config);

async function initManager() {
  await manager.init(keysFromEnv);
}

program
  .command('stats')
  .description('View statistics for all API keys')
  .action(async () => {
    await initManager();
    const stats = manager.getStats();
    console.table(stats);
    await manager.shutdown();
  });

program
  .command('health')
  .description('View overall system health')
  .action(async () => {
    await initManager();
    const stats = manager.getStats();
    const available = stats.filter(s => s.status === 'available').length;
    const cooling = stats.filter(s => s.status === 'cooling').length;
    
    console.log(picocolors.bold('\n--- Health Report ---'));
    console.log(`Total Keys: ${stats.length}`);
    console.log(picocolors.green(`Available: ${available}`));
    console.log(picocolors.yellow(`Cooling: ${cooling}`));
    console.log(`Uptime: ${manager.getUptime()}ms\n`);
    await manager.shutdown();
  });

program
  .command('list')
  .description('List all keys and their statuses')
  .action(async () => {
    await initManager();
    const raw = manager.getRawKeys();
    raw.forEach(k => {
      let statusColor = picocolors.white;
      if (k.status === 'available') statusColor = picocolors.green;
      if (k.status === 'cooling') statusColor = picocolors.yellow;
      if (k.status === 'busy') statusColor = picocolors.blue;
      
      console.log(`ID: ${k.id} | Status: ${statusColor(k.status.toUpperCase())}`);
    });
    await manager.shutdown();
  });

program
  .command('cooldowns')
  .description('List keys currently in cooldown')
  .action(async () => {
    await initManager();
    const raw = manager.getRawKeys().filter(k => k.status === 'cooling');
    if (raw.length === 0) {
      console.log(picocolors.green('No keys in cooldown!'));
    } else {
      raw.forEach(k => {
        const timeStr = k.cooldownUntil ? new Date(k.cooldownUntil).toLocaleString() : 'Unknown';
        console.log(`ID: ${k.id} | Cooling until: ${timeStr}`);
      });
    }
    await manager.shutdown();
  });

program
  .command('export')
  .argument('<file>', 'File to export to')
  .description('Export keys state to a file')
  .action(async (file) => {
    await initManager();
    const keys = manager.getRawKeys();
    await fs.writeFile(file, JSON.stringify(keys, null, 2), 'utf-8');
    console.log(picocolors.green(`Exported state to ${file}`));
    await manager.shutdown();
  });

program
  .command('import')
  .argument('<file>', 'File to import from')
  .description('Import keys state from a file')
  .action(async (file) => {
    try {
      const data = await fs.readFile(file, 'utf-8');
      const keys = JSON.parse(data);
      await storage.saveKeys(keys);
      console.log(picocolors.green(`Imported state from ${file}`));
    } catch (err: any) {
      console.error(picocolors.red(`Failed to import: ${err.message}`));
    }
  });

program
  .command('reset')
  .description('Reset statistics for all keys')
  .action(async () => {
    await initManager();
    const keys = manager.getRawKeys();
    for (const key of keys) {
      key.requests = 0;
      key.successes = 0;
      key.failures = 0;
      key.rateLimitHits = 0;
      key.totalLatencyMs = 0;
      key.status = 'available';
      key.cooldownUntil = null;
    }
    await storage.saveKeys(keys);
    console.log(picocolors.green('All key statistics have been reset.'));
    await manager.shutdown();
  });

program
  .command('add')
  .argument('<id>', 'Key ID')
  .argument('<apiKey>', 'The API Key string')
  .description('Add a new API key locally')
  .action(async (id, apiKey) => {
    await initManager();
    const keys = manager.getRawKeys();
    if (keys.find(k => k.id === id)) {
      console.log(picocolors.red(`Key ID ${id} already exists!`));
    } else {
      keys.push({
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
      });
      await storage.saveKeys(keys);
      console.log(picocolors.green(`Added key ${id}`));
    }
    await manager.shutdown();
  });

program
  .command('test')
  .description('Test the API with a single key')
  .action(async () => {
    await initManager();
    const client = new AerolinkClient(manager, getBaseUrl(), getModel());
    try {
      console.log('Sending test request...');
      const response = await client.chat([{ role: 'user', content: 'Reply only with OK.' }]);
      console.log(picocolors.green('Success!'), JSON.stringify(response.content?.[0] || response));
    } catch (err: any) {
      console.error(picocolors.red('Test Failed:'), err.message);
    }
    await manager.shutdown();
  });

program.parse(process.argv);
