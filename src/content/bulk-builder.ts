import { ADAPTERS } from "../adapters";
import { logger } from "../core/logger";
import { getProviderConversationUrl } from "../core/provider-urls";
import type { Attachment, Conversation, Message, Part, ProviderId } from "../core/types";
import { extractAttachmentsFromText } from "../core/attachments";

export interface BulkBuildOptions {
  saveAttachments?: boolean;
  attachmentsFolder?: string;
}

interface ParsedBulkConversation {
  title: string;
  url: string;
  chatId?: string;
  providerModel?: string;
  messages: Message[];
  attachments?: Attachment[];
  warnings?: string[];
}

function adapterForProvider(providerId: ProviderId) {
  return ADAPTERS.find((adapter) => adapter.id === providerId);
}

function isConversation(data: any): data is Conversation {
  return data && data.schemaVersion === 1 && Array.isArray(data.messages) && typeof data.title === "string";
}

function normalizeMessage(raw: any): Message | undefined {
  if (!raw) return undefined;
  const role = raw.role === "user" || raw.sender === "human" ? "user" : raw.role || "assistant";
  const parts: Part[] = [];

  if (Array.isArray(raw.parts)) {
    for (const part of raw.parts) {
      if (part && typeof part === "object") {
        if (part.type === "text" && typeof part.content === "string") {
          parts.push({ type: "text", markdown: part.content } as Part);
        } else if (part.type === "text" && typeof part.text === "string") {
          parts.push({ type: "text", markdown: part.text } as Part);
        } else if (part.type === "text" && typeof part.markdown === "string") {
          parts.push({ type: "text", markdown: part.markdown } as Part);
        } else if (part.type === "code" && typeof part.code === "string") {
          parts.push({ type: "code", code: part.code, lang: part.lang } as Part);
        } else if (part.type === "thinking" && typeof part.markdown === "string") {
          parts.push({ type: "thinking", markdown: part.markdown } as Part);
        }
      }
    }
  } else if (typeof raw.content === "string" || typeof raw.text === "string" || typeof raw.message === "string") {
    parts.push({ type: "text", markdown: String(raw.content ?? raw.text ?? raw.message ?? "") } as Part);
  } else if (raw.content != null) {
    parts.push({ type: "text", markdown: JSON.stringify(raw.content, null, 2) } as Part);
  }

  if (!parts.length) return undefined;
  return {
    role,
    parts,
    createdAt: raw.createdAt || raw.created_at || raw.timestamp,
  };
}

function normalizeMessages(rawMessages: any): Message[] {
  return rawMessages.map(normalizeMessage).filter((m: any): m is Message => Boolean(m));
}

function normalizeAttachments(rawAttachments: any, text = ""): Attachment[] {
  if (Array.isArray(rawAttachments)) {
    return rawAttachments.filter((a) => a?.name && a?.url).map((a) => ({ ...a }));
  }
  return extractAttachmentsFromText(text);
}

export async function buildConversationFromBulk(
  providerId: ProviderId,
  data: any,
  options: BulkBuildOptions = {}
): Promise<Conversation> {
  if (isConversation(data)) {
    return {
      ...data,
      provider: providerId,
      schemaVersion: 1,
      title: data.title || "Untitled conversation",
      url: data.url || getProviderConversationUrl(providerId, data.chatId || ""),
      capturedAt: data.capturedAt || new Date().toISOString(),
      messages: data.messages,
      warnings: data.warnings || [],
      attachments: data.attachments || [],
    };
  }

  const adapter = adapterForProvider(providerId);
  let parsed: ParsedBulkConversation | undefined;

  // If data is a JSON string, parse it first
  if (typeof data === "string") {
    try {
      const parsedObj = JSON.parse(data);
      if (parsedObj && typeof parsedObj === "object") {
        data = parsedObj;
      }
    } catch { /* not valid JSON, keep as string */ }
  }

  if (adapter?.parseBulkData && typeof data === "object") {
    try {
      parsed = await adapter.parseBulkData(data, options);
    } catch (err: any) {
      logger.warn(`Adapter ${providerId} could not parse bulk data directly`, { error: err.message });
    }
  }

  if (!parsed || !parsed.messages?.length) {
    const rawMessages = typeof data === "object" && data !== null
      ? (Array.isArray(data.messages) ? data.messages : Array.isArray(data.chat_messages) ? data.chat_messages : [])
      : [];
    const text = typeof data === "object" && data !== null ? JSON.stringify(data, null, 2) : String(data || "");
    if (!parsed) {
      parsed = {
        title: data?.title || data?.name || "Untitled conversation",
        url: data?.url || getProviderConversationUrl(providerId, data?.id || data?.uuid || data?.conversationId || ""),
        chatId: data?.id || data?.uuid || data?.conversationId,
        providerModel: data?.model || data?.providerModel,
        messages: normalizeMessages(rawMessages),
        attachments: normalizeAttachments(data?.attachments, text),
        warnings: [],
      };
    } else {
      // Adapter returned empty messages; try generic fallback
      parsed.messages = normalizeMessages(rawMessages);
      if (!parsed.attachments?.length) {
        parsed.attachments = normalizeAttachments(data?.attachments, text);
      }
    }
  }

  const messages = parsed.messages?.length ? parsed.messages : [];

  return {
    schemaVersion: 1,
    provider: providerId,
    providerModel: parsed.providerModel,
    chatId: parsed.chatId || data?.id || data?.uuid || data?.conversationId,
    title: parsed.title || "Untitled conversation",
    url: parsed.url || getProviderConversationUrl(providerId, parsed.chatId || ""),
    capturedAt: new Date().toISOString(),
    messages: messages as Message[],
    warnings: parsed.warnings || [],
    attachments: parsed.attachments || [],
  };
}
