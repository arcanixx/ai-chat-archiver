import { describe, expect, it } from 'vitest';
import { buildFilename } from '../src/core/filename';
import type { Conversation } from '../src/core/types';

describe('Filename Builder', () => {
  const mockConversation: Conversation = {
    schemaVersion: 1,
    provider: 'claude',
    title: 'Test Conversation About Programming',
    url: 'https://claude.ai/chat/abc123',
    capturedAt: '2024-01-01T12:00:00.000Z',
    messages: [
      {
        role: 'user',
        parts: [{ type: 'text', markdown: 'Hello' }],
        createdAt: '2024-01-01T12:00:00.000Z'
      }
    ],
    warnings: [],
    attachments: [],
    chatId: 'abc123'
  };

  describe('Default template', () => {
    it('should return just extension for empty template', () => {
      const filename = buildFilename('', mockConversation, '.md');
      
      expect(filename).toBe('.md');
    });

    it('should create filename with provider and title template', () => {
      const template = '{provider} - {title}';
      const filename = buildFilename(template, mockConversation, '.md');
      
      expect(filename).toBe('claude - Test-Conversation-About-Programming.md');
    });

    it('should sanitize special characters in title', () => {
      const conversationWithSpecialChars: Conversation = {
        ...mockConversation,
        title: 'Test: Programming/with*special?chars"and<more>'
      };
      
      const template = '{provider} - {title}';
      const filename = buildFilename(template, conversationWithSpecialChars, '.md');
      
      expect(filename).toBe('claude - Test-Programming-with-special-chars-and-more.md');
    });

    it('should handle very long titles', () => {
      const longTitle = 'x'.repeat(300);
      const conversationWithLongTitle: Conversation = {
        ...mockConversation,
        title: longTitle
      };
      
      const template = '{provider} - {title}';
      const filename = buildFilename(template, conversationWithLongTitle, '.md');
      
      expect(filename.length).toBeLessThanOrEqual(255); // Max filename length
      expect(filename).toContain('claude');
    });
  });

  describe('Custom templates', () => {
    it('should use title template', () => {
      const template = '{title}';
      const filename = buildFilename(template, mockConversation, 'md');
      
      expect(filename).toBe('Test-Conversation-About-Programming.md');
    });

    it('should use provider template', () => {
      const template = '{provider}';
      const filename = buildFilename(template, mockConversation, 'md');
      
      expect(filename).toBe('claude.md');
    });

    it('should use date template', () => {
      const template = '{date}';
      const filename = buildFilename(template, mockConversation, 'md');
      
      expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/);
    });

    it('should use timestamp template', () => {
      const template = '{datetime}';
      const filename = buildFilename(template, mockConversation, 'md');
      
      expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}\d{2}\d{2}\.md$/);
    });

    it('should use chat ID template', () => {
      const template = '{chatId}';
      const filename = buildFilename(template, mockConversation, 'md');
      
      expect(filename).toBe('abc123.md');
    });

    it('should combine multiple templates', () => {
      const template = '{provider} - {title} - {date}';
      const filename = buildFilename(template, mockConversation, 'md');
      
      expect(filename).toMatch(/^claude - Test-Conversation-About-Programming - \d{4}-\d{2}-\d{2}\.md$/);
    });

    it('should handle complex template', () => {
      const template = '{provider}/{date}_{title}_{datetime}';
      const filename = buildFilename(template, mockConversation, 'md');
      
      expect(filename).toMatch(/^claude\/\d{4}-\d{2}-\d{2}_Test-Conversation-About-Programming_\d{4}-\d{2}-\d{2}-\d{2}\d{2}\d{2}\.md$/);
    });
  });

  describe('Folder support', () => {
    it('should add folder prefix', () => {
      const filename = buildFilename('', mockConversation, '.md', 'chats');
      
      expect(filename).toBe('chats/claude - Test Conversation About Programming.md');
    });

    it('should handle nested folders', () => {
      const filename = buildFilename('', mockConversation, '.md', 'chats/2024/01');
      
      expect(filename).toBe('chats/2024/01/claude - Test Conversation About Programming.md');
    });

    it('should handle trailing slashes in folder', () => {
      const filename = buildFilename('', mockConversation, '.md', 'chats/');
      
      expect(filename).toBe('chats/claude - Test Conversation About Programming.md');
    });
  });

  describe('Extension handling', () => {
    it('should add extension if not provided in template', () => {
      const template = '{provider} - {title}';
      const filename = buildFilename(template, mockConversation, 'md');
      
      expect(filename).toBe('claude - Test-Conversation-About-Programming.md');
    });

    it('should use extension from template if provided', () => {
      const template = '{provider} - {title}.txt';
      const filename = buildFilename(template, mockConversation, 'md');
      
      expect(filename).toBe('claude - Test-Conversation-About-Programming.txt');
    });

    it('should prioritize template extension', () => {
      const template = '{provider} - {title}.txt';
      const filename = buildFilename(template, mockConversation, 'md');
      
      expect(filename).toBe('claude - Test-Conversation-About-Programming.txt');
    });
  });

  describe('Edge cases', () => {
    it('should handle missing chat ID', () => {
      const conversationWithoutChatId: Conversation = {
        ...mockConversation,
        chatId: undefined
      };
      
      const filename = buildFilename('{chatId}', conversationWithoutChatId, 'md');
      
      expect(filename).toBe('.md');
    });

    it('should handle empty template', () => {
      const filename = buildFilename('', mockConversation, 'md');
      
      expect(filename).toBe('.md');
    });

    it('should handle template with only unknown placeholders', () => {
      const template = '{unknown} {placeholder}';
      const filename = buildFilename(template, mockConversation, 'md');
      
      expect(filename).toBe(' .md');
    });

    it('should handle template with mixed known and unknown placeholders', () => {
      const template = '{provider} {unknown} {title}';
      const filename = buildFilename(template, mockConversation, 'md');
      
      expect(filename).toBe('claude  Test-Conversation-About-Programming.md');
    });
  });

  describe('Collision handling', () => {
    it('should add suffix when file exists', () => {
      // Simulate file exists by using the same filename twice
      const filename1 = buildFilename('{provider} - {title}', mockConversation, 'md');
      const filename2 = buildFilename('{provider} - {title}', mockConversation, 'md');
      
      expect(filename1).toBe('claude - Test-Conversation-About-Programming.md');
      expect(filename2).toBe('claude - Test-Conversation-About-Programming 1.md');
    });

    it('should handle multiple collisions', () => {
      const filename1 = buildFilename('{provider} - {title}', mockConversation, 'md');
      const filename2 = buildFilename('{provider} - {title}', mockConversation, 'md');
      const filename3 = buildFilename('{provider} - {title}', mockConversation, 'md');
      
      expect(filename1).toBe('claude - Test-Conversation-About-Programming.md');
      expect(filename2).toBe('claude - Test-Conversation-About-Programming 1.md');
      expect(filename3).toBe('claude - Test-Conversation-About-Programming 2.md');
    });

    it('should handle complex collision scenarios', () => {
      const template = '{provider} - {title}';
      const filename1 = buildFilename(template, mockConversation, 'md');
      const filename2 = buildFilename(template, mockConversation, 'md');
      const filename3 = buildFilename(template, mockConversation, 'md');
      
      expect(filename1).toBe('claude - Test-Conversation-About-Programming.md');
      expect(filename2).toBe('claude - Test-Conversation-About-Programming 1.md');
      expect(filename3).toBe('claude - Test-Conversation-About-Programming 2.md');
    });
  });

  describe('Performance', () => {
    it('should handle many filename generations efficiently', () => {
      const start = performance.now();
      
      // Generate 100 filenames
      for (let i = 0; i < 100; i++) {
        buildFilename('', mockConversation, '.md');
      }
      
      const end = performance.now();
      const duration = end - start;
      
      expect(duration).toBeLessThan(100); // Should complete in under 100ms
    });

    it('should handle long conversations efficiently', () => {
      const longConversation: Conversation = {
        ...mockConversation,
        messages: Array.from({ length: 1000 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          parts: [{ type: 'text', markdown: `Message ${i}` }],
          createdAt: `2024-01-01T12:00:${i.toString().padStart(2, '0')}.000Z`
        }))
      };
      
      const start = performance.now();
      const filename = buildFilename('{provider} - {title}', longConversation, 'md');
      const end = performance.now();
      
      expect(filename).toBe('claude - Test-Conversation-About-Programming.md');
      expect(end - start).toBeLessThan(50); // Should complete in under 50ms
    });
  });
});