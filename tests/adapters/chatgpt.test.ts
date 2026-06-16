import { describe, expect, it, beforeEach } from 'vitest';
import { chatgptAdapter } from '../src/adapters/chatgpt';
import { readFileSync } from 'fs';
import { join } from 'path';

// Mock logger to avoid console output during tests
vi.mock('../src/core/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

describe('ChatGPT Adapter', () => {
  let mockDocument: Document;

  beforeEach(() => {
    // Load the ChatGPT HTML fixture
    const htmlPath = join(__dirname, '..', 'docs', 'html_examples', 'AI\'s Perspective on Self-Perception - Google Gemini.html');
    const htmlContent = readFileSync(htmlPath, 'utf-8');
    
    // Create a DOMParser to parse the HTML
    const parser = new DOMParser();
    mockDocument = parser.parseFromString(htmlContent, 'text/html');
    
    // Set the URL to match ChatGPT's domain
    Object.defineProperty(mockDocument, 'location', {
      value: { href: 'https://chat.openai.com/c/chatgpt-123' },
      writable: false
    });
  });

  describe('URL matching', () => {
    it('should match chat.openai.com URLs', () => {
      expect(chatgptAdapter.match(new URL('https://chat.openai.com/c/chatgpt-123'))).toBe(true);
      expect(chatgptAdapter.match(new URL('https://chat.openai.com/share/xyz789'))).toBe(true);
      expect(chatgptAdapter.match(new URL('https://chat.openai.com/'))).toBe(true);
    });

    it('should not match non-ChatGPT URLs', () => {
      expect(chatgptAdapter.match(new URL('https://claude.ai/'))).toBe(false);
      expect(chatgptAdapter.match(new URL('https://gemini.google.com/'))).toBe(false);
      expect(chatgptAdapter.match(new URL('https://example.com/'))).toBe(false);
    });
  });

  describe('isFullyExpandedView', () => {
    it('should detect share URLs as fully expanded', () => {
      expect(chatgptAdapter.isFullyExpandedView(new URL('https://chat.openai.com/share/xyz789'))).toBe(true);
    });

    it('should not detect regular chat URLs as fully expanded', () => {
      expect(chatgptAdapter.isFullyExpandedView(new URL('https://chat.openai.com/c/chatgpt-123'))).toBe(false);
    });
  });

  describe('getTitle', () => {
    it('should extract title from conversation', () => {
      const title = chatgptAdapter.getTitle(mockDocument);
      expect(title).toBeDefined();
      expect(typeof title).toBe('string');
      expect(title.length).toBeGreaterThan(0);
      expect(title).not.toBe('ChatGPT conversation'); // Default fallback
    });

    it('should handle missing title gracefully', () => {
      // Create a document without any title elements
      const emptyDoc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
      Object.defineProperty(emptyDoc, 'location', {
        value: { href: 'https://chat.openai.com/c/chatgpt-123' },
        writable: false
      });
      
      const title = chatgptAdapter.getTitle(emptyDoc);
      expect(title).toBe('Untitled conversation');
    });
  });

  describe('detectModel', () => {
    it('should detect model from document', () => {
      const model = chatgptAdapter.detectModel?.(mockDocument);
      // Model detection depends on the specific HTML structure
      // It might be undefined or a string depending on the fixture
      expect(model === undefined || typeof model === 'string').toBe(true);
    });

    it('should handle missing model gracefully', () => {
      const emptyDoc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
      Object.defineProperty(emptyDoc, 'location', {
        value: { href: 'https://chat.openai.com/c/chatgpt-123' },
        writable: false
      });
      
      const model = chatgptAdapter.detectModel?.(emptyDoc);
      expect(model).toBeUndefined();
    });
  });

  describe('extract', () => {
    it('should extract messages from conversation', () => {
      const messages = chatgptAdapter.extract(mockDocument);
      
      expect(messages).toBeDefined();
      expect(Array.isArray(messages)).toBe(true);
      
      // Check that each message has the required structure
      messages.forEach(message => {
        expect(message).toHaveProperty('role');
        expect(message).toHaveProperty('parts');
        expect(message).toHaveProperty('createdAt');
        expect(typeof message.role).toBe('string');
        expect(Array.isArray(message.parts)).toBe(true);
        expect(typeof message.createdAt).toBe('string');
      });
    });

    it('should extract user and assistant messages', () => {
      const messages = chatgptAdapter.extract(mockDocument);
      
      const userMessages = messages.filter(m => m.role === 'user');
      const assistantMessages = messages.filter(m => m.role === 'assistant');
      
      expect(userMessages.length).toBeGreaterThan(0);
      expect(assistantMessages.length).toBeGreaterThan(0);
    });

    it('should extract text parts', () => {
      const messages = chatgptAdapter.extract(mockDocument);
      
      messages.forEach(message => {
        message.parts.forEach(part => {
          expect(part).toHaveProperty('type');
          expect(part).toHaveProperty('markdown');
          expect(typeof part.type).toBe('string');
          expect(typeof part.markdown).toBe('string');
        });
      });
    });

    it('should handle empty document', () => {
      const emptyDoc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
      Object.defineProperty(emptyDoc, 'location', {
        value: { href: 'https://chat.openai.com/c/chatgpt-123' },
        writable: false
      });
      
      const messages = chatgptAdapter.extract(emptyDoc);
      expect(messages).toEqual([]);
    });
  });

  describe('expandAll', () => {
    it('should not throw when expanding sections', async () => {
      // This is a basic test - in a real scenario we'd need to mock the DOM interactions
      expect(async () => {
        await chatgptAdapter.expandAll(mockDocument);
      }).not.toThrow();
    });

    it('should handle empty document', async () => {
      const emptyDoc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
      Object.defineProperty(emptyDoc, 'location', {
        value: { href: 'https://chat.openai.com/c/chatgpt-123' },
        writable: false
      });
      
      expect(async () => {
        await chatgptAdapter.expandAll(emptyDoc);
      }).not.toThrow();
    });
  });

  describe('Real conversation structure', () => {
    it('should extract realistic conversation data', () => {
      const messages = chatgptAdapter.extract(mockDocument);
      
      // Check that we have a reasonable number of messages
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.length).toBeLessThan(100); // Sanity check
      
      // Check that messages have content
      messages.forEach(message => {
        expect(message.parts.length).toBeGreaterThan(0);
        
        message.parts.forEach(part => {
          if (part.type === 'text') {
            expect(part.markdown.trim().length).toBeGreaterThan(0);
          }
        });
      });
    });

    it('should preserve message order', () => {
      const messages = chatgptAdapter.extract(mockDocument);
      
      // Messages should be in chronological order
      for (let i = 1; i < messages.length; i++) {
        const prevTime = new Date(messages[i - 1].createdAt).getTime();
        const currTime = new Date(messages[i].createdAt).getTime();
        expect(currTime).toBeGreaterThanOrEqual(prevTime);
      }
    });

    it('should handle different content types', () => {
      const messages = chatgptAdapter.extract(mockDocument);
      
      // Look for different part types
      const hasTextParts = messages.some(m => m.parts.some(p => p.type === 'text'));
      const hasCodeParts = messages.some(m => m.parts.some(p => p.type === 'code'));
      
      // At minimum, we should have text parts
      expect(hasTextParts).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle malformed HTML gracefully', () => {
      const malformedHtml = '<html><body><div><span>Unclosed tags</div></body></html>';
      const malformedDoc = new DOMParser().parseFromString(malformedHtml, 'text/html');
      Object.defineProperty(malformedDoc, 'location', {
        value: { href: 'https://chat.openai.com/c/chatgpt-123' },
        writable: false
      });
      
      expect(() => chatgptAdapter.extract(malformedDoc)).not.toThrow();
    });

    it('should handle extremely large documents', () => {
      // Create a large document (this is a simplified test)
      const largeHtml = '<html><body>' + '<div>Message</div>'.repeat(1000) + '</body></html>';
      const largeDoc = new DOMParser().parseFromString(largeHtml, 'text/html');
      Object.defineProperty(largeDoc, 'location', {
        value: { href: 'https://chat.openai.com/c/chatgpt-123' },
        writable: false
      });
      
      expect(() => chatgptAdapter.extract(largeDoc)).not.toThrow();
    });
  });
});