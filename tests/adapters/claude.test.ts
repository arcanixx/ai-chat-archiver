import { describe, expect, it, beforeEach, vi } from 'vitest';
import { claudeAdapter } from '../../src/adapters/claude';

// Mock logger to avoid console output during tests
vi.mock('../../src/core/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

describe('Claude Adapter', () => {
  describe('URL matching', () => {
    it('should match claude.ai URLs', () => {
      expect(claudeAdapter.match(new URL('https://claude.ai/chat/abc123'))).toBe(true);
      expect(claudeAdapter.match(new URL('https://claude.ai/share/xyz789'))).toBe(true);
      expect(claudeAdapter.match(new URL('https://claude.ai/'))).toBe(true);
    });

    it('should not match non-Claude URLs', () => {
      expect(claudeAdapter.match(new URL('https://chat.openai.com/'))).toBe(false);
      expect(claudeAdapter.match(new URL('https://gemini.google.com/'))).toBe(false);
      expect(claudeAdapter.match(new URL('https://example.com/'))).toBe(false);
    });
  });

  describe('isFullyExpandedView', () => {
    it('should detect share URLs as fully expanded', () => {
      const url = new URL('https://claude.ai/share/abc123');
      expect(claudeAdapter.isFullyExpandedView?.(url)).toBe(true);
    });

    it('should not detect regular chat URLs as fully expanded', () => {
      const url = new URL('https://claude.ai/chat/abc123');
      expect(claudeAdapter.isFullyExpandedView?.(url)).toBe(false);
    });
  });

  describe('getTitle', () => {
    it('should fall back to "Untitled conversation" for empty document', () => {
      const doc = { title: '', querySelector: () => null } as any;
      expect(claudeAdapter.getTitle(doc)).toBe('Untitled conversation');
    });

    it('should return document title as fallback', () => {
      const doc = { title: 'Test Claude Chat', querySelector: () => null } as any;
      expect(claudeAdapter.getTitle(doc)).toBe('Test Claude Chat');
    });
  });

  describe('extract', () => {
    it('should return empty array for empty document', () => {
      const doc = { querySelectorAll: () => [], title: '', querySelector: () => null, location: { href: '' } } as any;
      const result = claudeAdapter.extract(doc) as any[];
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

    it('should have attachments support', () => {
      expect(claudeAdapter.extractAttachments).toBeDefined();
    });

  describe('bulk support', () => {
    it('should declare bulk support', () => {
      expect(claudeAdapter.supportsBulk).toBe(true);
    });

    it('should have fetchList and fetchDetail', () => {
      expect(claudeAdapter.fetchList).toBeDefined();
      expect(claudeAdapter.fetchDetail).toBeDefined();
    });
  });
});
