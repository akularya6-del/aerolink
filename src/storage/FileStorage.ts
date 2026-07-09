import fs from 'fs/promises';
import { StorageInterface } from './StorageInterface.js';
import { ApiKey } from '../manager/types.js';
import { logger } from '../utils/logger.js';
import { Mutex } from 'async-mutex';

export class FileStorage implements StorageInterface {
  private mutex = new Mutex();

  constructor(private filePath: string) {}

  async loadKeys(): Promise<ApiKey[]> {
    return await this.mutex.runExclusive(async () => {
      try {
        const data = await fs.readFile(this.filePath, 'utf-8');
        return JSON.parse(data) as ApiKey[];
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          logger.debug(`Storage file not found at ${this.filePath}, starting fresh.`);
          return [];
        }
        logger.error(`Error reading keys from storage: ${error.message}`);
        throw error;
      }
    });
  }

  async saveKeys(keys: ApiKey[]): Promise<void> {
    await this.mutex.runExclusive(async () => {
      try {
        // Write to a temporary file first for atomic writes
        const tempPath = `${this.filePath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(keys, null, 2), 'utf-8');
        await fs.rename(tempPath, this.filePath);
      } catch (error: any) {
        logger.error(`Error saving keys to storage: ${error.message}`);
        throw error;
      }
    });
  }
}
