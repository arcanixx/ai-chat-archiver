import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../core/logger';

// Mock chrome.storage.local
const mockChromeStorage = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
};

// Mock chrome API
global.chrome = {
  storage: mockChromeStorage,
} as any;

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset logger state
    logger.entries = [];
    logger.maxEntries = 500;
  });

  describe('log levels', () => {
    it('should have different log levels', () => {
      expect(logger.debug).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.error).toBeDefined();
    });

    it('should store log entries with correct levels', () => {
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(logger.entries).toHaveLength(4);
      expect(logger.entries[0].level).toBe('debug');
      expect(logger.entries[1].level).toBe('info');
      expect(logger.entries[2].level).toBe('warn');
      expect(logger.entries[3].level).toBe('error');
    });
  });

  describe('message formatting', () => {
    it('should store basic messages', () => {
      logger.info('Test message');
      
      expect(logger.entries).toHaveLength(1);
      expect(logger.entries[0].message).toBe('Test message');
      expect(logger.entries[0].level).toBe('info');
      expect(logger.entries[0].timestamp).toBeDefined();
      expect(logger.entries[0].traceId).toBeDefined();
    });

    it('should store messages with context', () => {
      logger.info('Test message', { key: 'value', number: 42 });
      
      expect(logger.entries).toHaveLength(1);
      expect(logger.entries[0].message).toBe('Test message');
      expect(logger.entries[0].context).toEqual({ key: 'value', number: 42 });
    });

    it('should handle errors with stack traces', () => {
      const error = new Error('Test error');
      logger.error('Error occurred', { error });
      
      expect(logger.entries).toHaveLength(1);
      expect(logger.entries[0].message).toBe('Error occurred');
      expect(logger.entries[0].context?.error).toBe('Test error');
      expect(logger.entries[0].context?.stack).toBeDefined();
    });
  });

  describe('ring buffer behavior', () => {
    it('should respect maxEntries limit', () => {
      logger.maxEntries = 3;
      
      logger.info('First');
      logger.info('Second');
      logger.info('Third');
      logger.info('Fourth'); // This should push out the first entry
      
      expect(logger.entries).toHaveLength(3);
      expect(logger.entries[0].message).toBe('Second');
      expect(logger.entries[1].message).toBe('Third');
      expect(logger.entries[2].message).toBe('Fourth');
    });

    it('should not exceed maxEntries', () => {
      logger.maxEntries = 5;
      
      // Add more entries than max
      for (let i = 0; i < 10; i++) {
        logger.info(`Message ${i}`);
      }
      
      expect(logger.entries).toHaveLength(5);
      expect(logger.entries[0].message).toBe('Message 5');
      expect(logger.entries[4].message).toBe('Message 9');
    });
  });

  describe('clear method', () => {
    it('should clear all entries', () => {
      logger.info('Test message');
      logger.info('Another message');
      
      expect(logger.entries).toHaveLength(2);
      
      logger.clear();
      
      expect(logger.entries).toHaveLength(0);
    });
  });

  describe('getEntries method', () => {
    it('should return entries filtered by level', () => {
      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warning');
      logger.error('Error');
      
      const allEntries = logger.getEntries();
      const errorEntries = logger.getEntries('error');
      
      expect(allEntries).toHaveLength(4);
      expect(errorEntries).toHaveLength(1);
      expect(errorEntries[0].message).toBe('Error');
    });

    it('should return entries filtered by time range', () => {
      const now = Date.now();
      const oldTime = now - 1000; // 1 second ago
      
      logger.entries.push({
        timestamp: oldTime,
        level: 'info',
        message: 'Old message',
        traceId: 'test',
        context: {}
      });
      
      logger.info('New message');
      
      const recentEntries = logger.getEntries(undefined, now);
      expect(recentEntries).toHaveLength(1);
      expect(recentEntries[0].message).toBe('New message');
    });
  });

  describe('chrome.storage integration', () => {
    it('should persist to chrome.storage when enabled', async () => {
      await logger.persist();
      
      expect(mockChromeStorage.local.set).toHaveBeenCalledWith({
        'ai-archiver-logs': expect.any(Array)
      });
    });

    it('should load from chrome.storage when available', async () => {
      const mockEntries = [
        { timestamp: Date.now(), level: 'info', message: 'Test', traceId: 'test', context: {} }
      ];
      
      mockChromeStorage.local.get.mockResolvedValue({ 'ai-archiver-logs': mockEntries });
      
      await logger.load();
      
      expect(logger.entries).toHaveLength(1);
      expect(logger.entries[0].message).toBe('Test');
    });

    it('should handle missing storage gracefully', async () => {
      mockChromeStorage.local.get.mockResolvedValue({});
      
      await expect(logger.load()).resolves.not.toThrow();
      
      expect(logger.entries).toHaveLength(0);
    });
  });

  describe('performance', () => {
    it('should handle many entries efficiently', () => {
      const start = performance.now();
      
      // Add 1000 entries
      for (let i = 0; i < 1000; i++) {
        logger.info(`Message ${i}`, { id: i });
      }
      
      const end = performance.now();
      const duration = end - start;
      
      expect(logger.entries).toHaveLength(500); // maxEntries limit
      expect(duration).toBeLessThan(100); // Should complete in under 100ms
    });
  });
});