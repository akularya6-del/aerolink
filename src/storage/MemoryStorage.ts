import { StorageInterface } from './StorageInterface.js';
import { ApiKey } from '../manager/types.js';

export class MemoryStorage implements StorageInterface {
  private keys: ApiKey[] = [];

  constructor(initialKeys: ApiKey[] = []) {
    this.keys = [...initialKeys];
  }

  async loadKeys(): Promise<ApiKey[]> {
    return [...this.keys];
  }

  async saveKeys(keys: ApiKey[]): Promise<void> {
    this.keys = [...keys];
  }
}
