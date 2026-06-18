import { describe, expect, it, vi } from 'vitest';
import { geminiAdapter } from '../../src/adapters/gemini';

vi.mock('../../src/core/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

describe('Gemini Adapter', () => {
  describe('URL matching', () => {
    it('should match gemini.google.com URLs', () => {
      expect(geminiAdapter.match(new URL('https://gemini.google.com/'))).toBe(true);
      expect(geminiAdapter.match(new URL('https://gemini.google.com/app/abc123'))).toBe(true);
      expect(geminiAdapter.match(new URL('https://gemini.google.com/share/xyz789'))).toBe(true);
    });

    it('should not match non-Gemini URLs', () => {
      expect(geminiAdapter.match(new URL('https://claude.ai/'))).toBe(false);
      expect(geminiAdapter.match(new URL('https://example.com/'))).toBe(false);
    });
  });

  describe('isFullyExpandedView', () => {
    it('should detect share URLs as fully expanded', () => {
      expect(geminiAdapter.isFullyExpandedView?.(new URL('https://gemini.google.com/share/abc123'))).toBe(true);
    });

    it('should not detect regular app URLs as fully expanded', () => {
      expect(geminiAdapter.isFullyExpandedView?.(new URL('https://gemini.google.com/app/abc123'))).toBe(false);
    });
  });

  describe('getTitle', () => {
    it('should fall back to "Untitled conversation" for empty document', () => {
      const doc = { title: '', querySelector: () => null } as any;
      expect(geminiAdapter.getTitle(doc)).toBe('Untitled conversation');
    });

    it('should strip "Google Gemini" suffix from title', () => {
      const doc = { title: 'How to cook pasta - Google Gemini', querySelector: () => null } as any;
      expect(geminiAdapter.getTitle(doc)).toBe('How to cook pasta');
    });

    it('should handle RLM character prefix in title', () => {
      const doc = { title: '\u200eHello world - Google Gemini', querySelector: () => null } as any;
      expect(geminiAdapter.getTitle(doc)).toBe('Hello world');
    });
  });

  describe('extract', () => {
    it('should return empty array for empty document', () => {
      const doc = { querySelectorAll: () => [], title: '', querySelector: () => null, location: { href: '' } } as any;
      const result = geminiAdapter.extract(doc) as any[];
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('bulk support', () => {
    it('should declare bulk support', () => {
      expect(geminiAdapter.supportsBulk).toBe(true);
    });

    it('should have fetchList and fetchDetail', () => {
      expect(geminiAdapter.fetchList).toBeDefined();
      expect(geminiAdapter.fetchDetail).toBeDefined();
    });

    it('should have extractAttachments', () => {
      expect(geminiAdapter.extractAttachments).toBeDefined();
    });
  });
});
