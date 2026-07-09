import { ApiKey } from '../manager/types.js';

export interface StorageInterface {
  loadKeys(): Promise<ApiKey[]>;
  saveKeys(keys: ApiKey[]): Promise<void>;
}
