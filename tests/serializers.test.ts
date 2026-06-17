import { describe, expect, it } from 'vitest';
import { serialize } from '../src/core/serializers';
import type { Conversation, ExportFormat } from '../src/core/types';

describe('Serializers', () => {
  const mockConversation: Conversation = {
    schemaVersion: 1,
    provider: 'claude',
    title: 'Test Conversation',
    url: 'https://claude.ai/test',
    capturedAt: '2024-01-01T12:00:00.000Z',
    messages: [
      {
        role: 'user',
        parts: [
          { type: 'text', markdown: 'Hello, can you help me with a programming problem?' }
        ],
        createdAt: '2024-01-01T12:00:00.000Z'
      },
      {
        role: 'assistant',
        parts: [
          { type: 'text', markdown: 'Of course! I\'d be happy to help you with your programming problem.' },
          { type: 'code', lang: 'javascript', code: 'function hello() {\n  console.log("Hello, World!");\n}' }
        ],
        createdAt: '2024-01-01T12:00:01.000Z'
      },
      {
        role: 'user',
        parts: [
          { type: 'text', markdown: 'Thanks! Can you show me how to use it?' }
        ],
        createdAt: '2024-01-01T12:00:02.000Z'
      }
    ],
    warnings: [],
    attachments: []
  };

  describe('Markdown serialization', () => {
    it('should convert conversation to markdown format with YAML frontmatter', () => {
      const result = serialize(mockConversation, 'md');
      
      expect(result.text).toContain('---');
      expect(result.text).toContain('schema_version: 1');
      expect(result.text).toContain('provider: claude');
      expect(result.text).toContain('provider_label: Claude');
      expect(result.text).toContain('title: Test Conversation');
      expect(result.text).toContain('url: "https://claude.ai/test"');
      expect(result.text).toContain('captured_at: "2024-01-01T12:00:00.000Z"');
      expect(result.text).toContain('message_count: 3');
      expect(result.text).toContain('# Test Conversation');
      expect(result.text).toContain('🧑 User');
      expect(result.text).toContain('🤖 Assistant');
      expect(result.text).toContain('```javascript');
      expect(result.text).toContain('```');
      expect(result.mime).toBe('text/markdown');
      expect(result.ext).toBe('md');
    });

    it('should include code blocks with language specification', () => {
      const result = serialize(mockConversation, 'md');
      
      expect(result.text).toContain('```javascript');
      expect(result.text).toContain('```');
    });

    it('should handle empty conversation', () => {
      const emptyConversation: Conversation = {
        ...mockConversation,
        messages: []
      };
      
      const result = serialize(emptyConversation, 'md');
      
      expect(result.text).toContain('# Test Conversation');
      expect(result.text).toContain('message_count: 0');
    });

    it('should handle warnings', () => {
      const conversationWithWarnings: Conversation = {
        ...mockConversation,
        warnings: ['Some warning message']
      };
      
      const result = serialize(conversationWithWarnings, 'md');
      
      expect(result.text).toContain('warnings:');
      expect(result.text).toContain('- Some warning message');
    });
  });

  describe('HTML serialization', () => {
    it('should convert conversation to HTML format', () => {
      const result = serialize(mockConversation, 'html');
      
      expect(result.text).toContain('<!doctype html>');
      expect(result.text).toContain('<title>Test Conversation — Claude</title>');
      expect(result.text).toContain('<h1>Test Conversation</h1>');
      expect(result.text).toContain('<section class="msg role-assistant">');
      expect(result.text).toContain('<pre><code class="language-javascript">');
      expect(result.mime).toBe('text/html');
      expect(result.ext).toBe('html');
    });

    it('should include proper HTML structure', () => {
      const result = serialize(mockConversation, 'html');
      
      expect(result.text).toContain('<!doctype html>');
      expect(result.text).toContain('<html lang="en">');
      expect(result.text).toContain('<head>');
      expect(result.text).toContain('<body>');
      expect(result.text).toContain('</body>');
      expect(result.text).toContain('</html>');
    });

    it('should include CSS styling', () => {
      const result = serialize(mockConversation, 'html');
      
      expect(result.text).toContain('<style>');
      expect(result.text).toContain('.msg {');
      expect(result.text).toContain('.role-user h2 {');
      expect(result.text).toContain('pre {');
      expect(result.text).toContain('code {');
    });
  });

  describe('JSON serialization', () => {
    it('should convert conversation to JSON format', () => {
      const result = serialize(mockConversation, 'json');
      
      expect(result.text).toContain('{');
      expect(result.text).toContain('"schemaVersion": 1');
      expect(result.text).toContain('"provider": "claude"');
      expect(result.text).toContain('"title": "Test Conversation"');
      expect(result.text).toContain('"messages": [');
      expect(result.text).toContain('"role": "user"');
      expect(result.text).toContain('"role": "assistant"');
      expect(result.mime).toBe('application/json');
      expect(result.ext).toBe('json');
    });

    it('should produce valid JSON', () => {
      const result = serialize(mockConversation, 'json');
      
      // Should be valid JSON
      expect(() => JSON.parse(result.text)).not.toThrow();
      
      const parsed = JSON.parse(result.text);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.provider).toBe('claude');
      expect(parsed.title).toBe('Test Conversation');
      expect(parsed.messages).toHaveLength(3);
    });
  });

  describe('Edge cases', () => {
    it('should handle special characters in messages', () => {
      const specialCharsConversation: Conversation = {
        ...mockConversation,
        messages: [
          {
            role: 'user',
            parts: [
              { type: 'text', markdown: 'Special chars: < > & " \'' }
            ],
            createdAt: '2024-01-01T12:00:00.000Z'
          }
        ]
      };
      
      const mdResult = serialize(specialCharsConversation, 'md');
      const htmlResult = serialize(specialCharsConversation, 'html');
      
      // Markdown should preserve special characters
      expect(mdResult.text).toContain('Special chars: < > & " \'');
      
      // HTML should escape special characters
      expect(htmlResult.text).toContain('Special chars: &lt; &gt; &amp; &quot; &#39;');
    });

    it('should handle code with special characters', () => {
      const codeConversation: Conversation = {
        ...mockConversation,
        messages: [
          {
            role: 'assistant',
            parts: [
              { type: 'code', lang: 'html', code: '<div>Hello & "World"</div>' }
            ],
            createdAt: '2024-01-01T12:00:00.000Z'
          }
        ]
      };
      
      const mdResult = serialize(codeConversation, 'md');
      const htmlResult = serialize(codeConversation, 'html');
      
      // Markdown should preserve code as-is
      expect(mdResult.text).toContain('<div>Hello & "World"</div>');
      
      // HTML should escape code content
      expect(htmlResult.text).toContain('&lt;div&gt;Hello &amp; &quot;World&quot;&lt;/div&gt;');
    });

    it('should handle very long messages', () => {
      const longText = 'x'.repeat(10000);
      const longConversation: Conversation = {
        ...mockConversation,
        messages: [
          {
            role: 'user',
            parts: [
              { type: 'text', markdown: longText }
            ],
            createdAt: '2024-01-01T12:00:00.000Z'
          }
        ]
      };
      
      expect(() => serialize(longConversation, 'md')).not.toThrow();
      expect(() => serialize(longConversation, 'html')).not.toThrow();
      expect(() => serialize(longConversation, 'json')).not.toThrow();
    });

    it('should handle empty parts', () => {
      const emptyPartsConversation: Conversation = {
        ...mockConversation,
        messages: [
          {
            role: 'user',
            parts: [
              { type: 'text', markdown: '' }
            ],
            createdAt: '2024-01-01T12:00:00.000Z'
          }
        ]
      };
      
      const result = serialize(emptyPartsConversation, 'md');
      
      // Should include the message even if it's empty
      expect(result.text).toContain('🧑 User');
      expect(result.text).toContain('');
    });
  });

  describe('Performance', () => {
    it('should handle large conversations efficiently', () => {
      const largeConversation: Conversation = {
        ...mockConversation,
        messages: Array.from({ length: 100 }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          parts: [
            { type: 'text', markdown: `Message ${i}: This is a test message with some content.` },
            ...(i % 3 === 0 ? [{ type: 'code', lang: 'javascript', code: `console.log("Hello ${i}");` }] : [])
          ],
          createdAt: `2024-01-01T12:00:${i.toString().padStart(2, '0')}.000Z`
        }))
      };
      
      const start = performance.now();
      const result = serialize(largeConversation, 'md');
      const end = performance.now();
      
      expect(result.text.length).toBeGreaterThan(0);
      expect(end - start).toBeLessThan(1000); // Should complete in under 1 second
    });
  });
});