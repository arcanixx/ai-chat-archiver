import { describe, expect, it, vi } from 'vitest';
import { deepseekAdapter } from '../../src/adapters/deepseek';

vi.mock('../../src/core/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

describe('DeepSeek Adapter', () => {
  describe('URL matching', () => {
    it('should match chat.deepseek.com URLs', () => {
      expect(deepseekAdapter.match(new URL('https://chat.deepseek.com/'))).toBe(true);
      expect(deepseekAdapter.match(new URL('https://chat.deepseek.com/a/chat/s/abc123'))).toBe(true);
      expect(deepseekAdapter.match(new URL('https://chat.deepseek.com/share/gerfr6f4f4qojv6m1c'))).toBe(true);
    });

    it('should not match non-DeepSeek URLs', () => {
      expect(deepseekAdapter.match(new URL('https://claude.ai/'))).toBe(false);
      expect(deepseekAdapter.match(new URL('https://example.com/'))).toBe(false);
    });
  });

  describe('isFullyExpandedView', () => {
    it('should return false for all URLs (no share-page optimization)', () => {
      expect(deepseekAdapter.isFullyExpandedView?.(new URL('https://chat.deepseek.com/share/abc'))).toBe(false);
      expect(deepseekAdapter.isFullyExpandedView?.(new URL('https://chat.deepseek.com/'))).toBe(false);
    });
  });

  describe('getTitle', () => {
    it('should fall back to "Untitled conversation" for empty document', () => {
      const doc = { title: '', querySelector: () => null } as any;
      expect(deepseekAdapter.getTitle(doc)).toBe('Untitled conversation');
    });

    it('should strip "DeepSeek" suffix from title', () => {
      const doc = { title: 'How to write tests - DeepSeek', querySelector: () => null } as any;
      expect(deepseekAdapter.getTitle(doc)).toBe('How to write tests');
    });
  });

  describe('extract', () => {
    it('should return empty array for empty document', async () => {
      const doc = { querySelectorAll: () => [], title: '', querySelector: () => null, location: { href: '' } } as any;
      const result = await deepseekAdapter.extract(doc) as any[];
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('bulk support', () => {
    it('should declare bulk support', () => {
      expect(deepseekAdapter.supportsBulk).toBe(true);
    });

    it('should have extractAttachments', () => {
      expect(deepseekAdapter.extractAttachments).toBeDefined();
    });
  });
});
