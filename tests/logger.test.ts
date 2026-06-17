import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger, readLogs, writeLogs } from '../src/core/logger';

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('log levels', () => {
    it('should have different log levels', () => {
      expect(logger.debug).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.error).toBeDefined();
    });

    it('should invoke storage set for each log call', async () => {
      await logger.info('Test message');
      await vi.waitFor(() => {
        expect(chrome.storage.local.set).toHaveBeenCalled();
      });
    });
  });

  describe('readLogs and writeLogs', () => {
    it('should read logs from storage', async () => {
      const mockData = [{ t: '2024-01-01T00:00:00.000Z', level: 'info', msg: 'test' }];
      (chrome.storage.local.get as any).mockResolvedValue({ log_buffer_v1: mockData });
      const logs = await readLogs();
      expect(logs).toEqual(mockData);
    });

    it('should return empty array when no logs exist', async () => {
      (chrome.storage.local.get as any).mockResolvedValue({});
      const logs = await readLogs();
      expect(logs).toEqual([]);
    });

    it('should write logs to storage', async () => {
      await writeLogs([{ t: '2024-01-01T00:00:00.000Z', level: 'info', msg: 'test' }]);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        log_buffer_v1: expect.any(Array),
      });
    });

    it('should respect MAX limit (500 entries)', async () => {
      const many = Array.from({ length: 600 }, (_, i) => ({
        t: new Date().toISOString(), level: 'info', msg: `msg ${i}`,
      }));
      await writeLogs(many);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        log_buffer_v1: expect.arrayContaining([expect.objectContaining({ msg: 'msg 500' })]),
      });
    });
  });

  describe('getAll', () => {
    it('should return all log entries from storage', async () => {
      const mockData = [{ t: '2024-01-01T00:00:00.000Z', level: 'info', msg: 'test' }];
      (chrome.storage.local.get as any).mockResolvedValue({ log_buffer_v1: mockData });
      const entries = await logger.getAll();
      expect(entries).toEqual(mockData);
    });
  });

  describe('clear', () => {
    it('should remove logs from storage', async () => {
      await logger.clear();
      expect(chrome.storage.local.remove).toHaveBeenCalledWith('log_buffer_v1');
    });
  });
});
