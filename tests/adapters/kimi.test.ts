import { describe, expect, it, vi } from 'vitest';
import { kimiAdapter } from '../../src/adapters/kimi';
import { extractAttachmentsFromElement } from '../../src/core/attachments';

vi.mock('../../src/core/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

describe('Kimi Adapter', () => {
  describe('URL matching', () => {
    it('should match kimi.com URLs', () => {
      expect(kimiAdapter.match(new URL('https://kimi.com/chat/abc123'))).toBe(true);
      expect(kimiAdapter.match(new URL('https://www.kimi.com/chat/abc123'))).toBe(true);
    });

    it('should not match non-Kimi URLs', () => {
      expect(kimiAdapter.match(new URL('https://claude.ai/'))).toBe(false);
      expect(kimiAdapter.match(new URL('https://example.com/'))).toBe(false);
    });
  });

  describe('isFullyExpandedView', () => {
    it('should detect share URLs as fully expanded', () => {
      expect(kimiAdapter.isFullyExpandedView?.(new URL('https://kimi.com/share/abc123'))).toBe(true);
    });

    it('should not detect regular chat URLs as fully expanded', () => {
      expect(kimiAdapter.isFullyExpandedView?.(new URL('https://kimi.com/chat/abc123'))).toBe(false);
    });
  });

  describe('getTitle', () => {
    it('should fall back to "Untitled conversation" for empty document', () => {
      const doc = { title: '', querySelector: () => null } as any;
      expect(kimiAdapter.getTitle(doc)).toBe('Untitled conversation');
    });

    it('should strip "Kimi" suffix from title', () => {
      const doc = { title: 'Test Chat - Kimi', querySelector: () => null } as any;
      expect(kimiAdapter.getTitle(doc)).toBe('Test Chat');
    });
  });

  describe('extract', () => {
    it('should return empty array for empty document', async () => {
      const doc = document.implementation.createHTMLDocument('test');
      const result = await kimiAdapter.extract(doc) as any[];
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('icon-cache attachment filtering', () => {
    it('extractAttachmentsFromElement should find icon-cache images', () => {
      const div = document.createElement('div');
      const img = document.createElement('img');
      img.src = 'https://kimi-web-img.moonshot.cn/prod-data/icon-cache-img/raw.githubusercontent.com/foo/icon.png';
      img.alt = 'GitHub icon';
      div.appendChild(img);

      const attachments = extractAttachmentsFromElement(div);
      expect(attachments.length).toBeGreaterThanOrEqual(1);
      expect(attachments[0].url).toContain('icon-cache-img');
    });

    it('the Kimi filter should exclude icon-cache URLs', () => {
      const filter = (url: string) => !/icon-cache|kimi-web-img\.moonshot\.cn\/prod-data/.test(url);
      expect(filter('https://kimi-web-img.moonshot.cn/prod-data/icon-cache-img/foo.png')).toBe(false);
      expect(filter('https://example.com/real-image.png')).toBe(true);
      expect(filter('https://kimi-web-img.moonshot.cn/prod-data/user-upload/photo.jpg')).toBe(false);
    });
  });

  describe('bulk support', () => {
    it('should declare bulk support', () => {
      expect(kimiAdapter.supportsBulk).toBe(true);
    });

    it('should have extractAttachments', () => {
      expect(kimiAdapter.extractAttachments).toBeDefined();
    });
  });
});
