import { describe, expect, it } from 'vitest';
import { buildConversationFromBulk, type BulkBuildOptions } from '../src/content/bulk-builder';
import type { Conversation, ProviderId } from '../src/core/types';

describe('Bulk Builder', () => {
  it('should handle a conversation object directly', async () => {
    const conv: Conversation = {
      schemaVersion: 1,
      provider: 'claude',
      title: 'Test',
      url: 'https://claude.ai/chat/abc',
      capturedAt: '2024-01-01T00:00:00.000Z',
      messages: [{ role: 'user', parts: [{ type: 'text', markdown: 'Hi' }] }],
      warnings: [],
    };
    const result = await buildConversationFromBulk('claude', conv);
    expect(result.title).toBe('Test');
    expect(result.messages).toHaveLength(1);
    expect(result.provider).toBe('claude');
  });

  it('should parse raw data with messages array', async () => {
    const data = {
      title: 'Raw Test',
      messages: [{ role: 'user', parts: [{ type: 'text', markdown: 'Hello' }] }],
    };
    const result = await buildConversationFromBulk('chatgpt', data);
    expect(result.title).toBe('Raw Test');
    expect(result.messages).toHaveLength(1);
    expect(result.provider).toBe('chatgpt');
  });

  it('should parse raw data with chat_messages', async () => {
    const data = {
      title: 'Chat Messages Test',
      chat_messages: [{ role: 'assistant', parts: [{ type: 'text', markdown: 'Reply' }] }],
    };
    const result = await buildConversationFromBulk('gemini', data);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('assistant');
  });

  it('should handle empty data gracefully', async () => {
    const result = await buildConversationFromBulk('unknown', {});
    expect(result.title).toBe('Untitled conversation');
    expect(result.messages).toEqual([]);
  });

  it('should add attachments when present in data', async () => {
    const data = {
      title: 'With Attachments',
      messages: [{ role: 'user', parts: [{ type: 'text', markdown: 'See attached' }] }],
      attachments: [{ name: 'test.png', url: 'https://example.com/test.png', mime: 'image/png' }],
    };
    const result = await buildConversationFromBulk('claude', data);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments![0].name).toBe('test.png');
  });

  it('should handle string data (JSON)', async () => {
    const data = JSON.stringify({
      title: 'From JSON String',
      messages: [{ role: 'user', parts: [{ type: 'text', markdown: 'Hello' }] }],
    });
    const result = await buildConversationFromBulk('deepseek', data);
    expect(result.title).toBe('From JSON String');
    expect(result.messages).toHaveLength(1);
  });

  it('should handle missing role gracefully', async () => {
    const data = {
      messages: [{ content: 'Just some text', sender: 'human' }],
    };
    const result = await buildConversationFromBulk('claude', data);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });
});
