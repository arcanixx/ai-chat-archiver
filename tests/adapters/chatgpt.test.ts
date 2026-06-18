import { describe, expect, it, vi } from 'vitest';
import { chatgptAdapter } from '../../src/adapters/chatgpt';

vi.mock('../../src/core/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

describe('ChatGPT Adapter', () => {
  describe('URL matching', () => {
    it('should match chatgpt.com URLs', () => {
      expect(chatgptAdapter.match(new URL('https://chatgpt.com/c/abc123'))).toBe(true);
      expect(chatgptAdapter.match(new URL('https://chat.openai.com/c/abc123'))).toBe(true);
    });

    it('should not match non-ChatGPT URLs', () => {
      expect(chatgptAdapter.match(new URL('https://claude.ai/'))).toBe(false);
      expect(chatgptAdapter.match(new URL('https://example.com/'))).toBe(false);
    });
  });

  describe('isFullyExpandedView', () => {
    it('should detect share URLs as fully expanded', () => {
      const url = new URL('https://chatgpt.com/share/abc123');
      expect(chatgptAdapter.isFullyExpandedView?.(url)).toBe(true);
    });

    it('should not detect regular chat URLs as fully expanded', () => {
      const url = new URL('https://chatgpt.com/c/abc123');
      expect(chatgptAdapter.isFullyExpandedView?.(url)).toBe(false);
    });
  });

  describe('extract', () => {
    it('should return empty array for empty document', async () => {
      const doc = { querySelectorAll: () => [], title: '', querySelector: () => null } as any;
      const result = await chatgptAdapter.extract(doc) as any[];
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('bulk support', () => {
    it('should declare bulk support', () => {
      expect(chatgptAdapter.supportsBulk).toBe(true);
    });
  });
});
