import { describe, expect, it } from 'vitest';
import { getMimeFromUrl, sanitizeFilename, attachmentToMarkdown, extractAttachmentsFromText, mergeAttachments } from '../src/core/attachments';
import type { Attachment } from '../src/core/types';

describe('Attachments', () => {
  describe('getMimeFromUrl', () => {
    it('should return correct MIME for known extensions', () => {
      expect(getMimeFromUrl('file.pdf')).toBe('application/pdf');
      expect(getMimeFromUrl('file.png')).toBe('image/png');
      expect(getMimeFromUrl('file.txt')).toBe('text/plain');
    });

    it('should return octet-stream for unknown extensions', () => {
      expect(getMimeFromUrl('file.xyz')).toBe('application/octet-stream');
    });

    it('should handle query strings in URL', () => {
      expect(getMimeFromUrl('file.pdf?download=1&token=abc')).toBe('application/pdf');
    });
  });

  describe('sanitizeFilename', () => {
    it('should replace unsafe characters', () => {
      expect(sanitizeFilename('hello/world:test')).toBe('hello_world_test');
    });

    it('should fall back to default when result is empty', () => {
      expect(sanitizeFilename('***')).toBe('attachment');
    });

    it('should use custom fallback', () => {
      expect(sanitizeFilename('***', 'myfile.txt')).toBe('myfile.txt');
    });
  });

  describe('attachmentToMarkdown', () => {
    it('should format attachment as markdown link', () => {
      const att: Attachment = { name: 'doc.pdf', url: 'https://example.com/doc.pdf', mime: 'application/pdf' };
      expect(attachmentToMarkdown(att)).toContain('**Attachment:**');
      expect(attachmentToMarkdown(att)).toContain('doc.pdf');
      expect(attachmentToMarkdown(att)).toContain('https://example.com/doc.pdf');
    });
  });

  describe('extractAttachmentsFromText', () => {
    it('should extract image URLs from markdown', () => {
      const text = '![alt](https://example.com/img.png) and ![img2](https://example.com/img2.jpg)';
      const result = extractAttachmentsFromText(text);
      expect(result).toHaveLength(2);
      expect(result[0].url).toBe('https://example.com/img.png');
    });

    it('should extract download links from markdown', () => {
      const text = '[file](https://example.com/file.pdf)';
      const result = extractAttachmentsFromText(text);
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('https://example.com/file.pdf');
    });

    it('should deduplicate by URL', () => {
      const text = '![img](https://example.com/img.png) and ![img again](https://example.com/img.png)';
      const result = extractAttachmentsFromText(text);
      expect(result).toHaveLength(1);
    });
  });

  describe('mergeAttachments', () => {
    it('should combine and deduplicate attachments', () => {
      const a: Attachment[] = [{ name: 'a.png', url: 'https://example.com/a.png' }];
      const b: Attachment[] = [{ name: 'b.png', url: 'https://example.com/b.png' }];
      const c: Attachment[] = [{ name: 'a.png', url: 'https://example.com/a.png' }];
      const result = mergeAttachments(a, b, c);
      expect(result).toHaveLength(2);
    });

    it('should handle undefined groups', () => {
      const a: Attachment[] = [{ name: 'a.png', url: 'https://example.com/a.png' }];
      const result = mergeAttachments(a, undefined);
      expect(result).toHaveLength(1);
    });
  });
});
