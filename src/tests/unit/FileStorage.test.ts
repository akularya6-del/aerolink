import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FileStorage } from '../../storage/FileStorage.js';
import fs from 'fs/promises';

vi.mock('fs/promises');

describe('FileStorage Unit Tests', () => {
  let storage: FileStorage;
  const filePath = 'mock-keys.json';

  beforeEach(() => {
    storage = new FileStorage(filePath);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should load keys from file', async () => {
    (fs.readFile as any).mockResolvedValueOnce(JSON.stringify([{ id: 'key1' }]));
    const keys = await storage.loadKeys();
    expect(keys.length).toBe(1);
    expect(keys[0].id).toBe('key1');
  });

  it('should return empty array if file does not exist (ENOENT)', async () => {
    const error: any = new Error('Not found');
    error.code = 'ENOENT';
    (fs.readFile as any).mockRejectedValueOnce(error);

    const keys = await storage.loadKeys();
    expect(keys).toEqual([]);
  });

  it('should throw if read fails with other error', async () => {
    const error: any = new Error('Permission denied');
    error.code = 'EACCES';
    (fs.readFile as any).mockRejectedValueOnce(error);

    await expect(storage.loadKeys()).rejects.toThrow('Permission denied');
  });

  it('should save keys using a temporary file for atomic write', async () => {
    (fs.writeFile as any).mockResolvedValueOnce(undefined);
    (fs.rename as any).mockResolvedValueOnce(undefined);

    await storage.saveKeys([{ id: 'key1' } as any]);

    expect(fs.writeFile).toHaveBeenCalledWith(`${filePath}.tmp`, expect.any(String), 'utf-8');
    expect(fs.rename).toHaveBeenCalledWith(`${filePath}.tmp`, filePath);
  });
});
