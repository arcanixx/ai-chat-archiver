import { expandUntilStable, nodeToParts, readTimestamp, filterUiChromeParts, type ProviderAdapter } from "./base";
import { extractAttachmentsFromDocument, extractAttachmentsFromElement, extractAttachmentsFromText, getMimeFromUrl, sanitizeFilename } from "../core/attachments";
import { logger } from "../core/logger";
import type { Attachment, Message, Part } from "../core/types";

async function extractIframeContent(container: Element): Promise<Part[]> {
  const parts: Part[] = [];
  const iframes = container.querySelectorAll("iframe");
  
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        const text = iframeDoc.body?.textContent?.trim();
        if (text && text.length > 50) {
          const src = iframe.src || iframe.getAttribute("src") || "unknown";
          parts.push({ 
            type: "text", 
            markdown: `**Iframe content (${src}):**\n\n${text}` 
          });
        }
      }
    } catch {
      const src = iframe.src || iframe.getAttribute("src") || "unknown";
      parts.push({ 
        type: "text", 
        markdown: `**Iframe detected (cross-origin, cannot extract):** ${src}` 
      });
    }
  }
  return parts;
}

async function extractSidePanelContent(doc: Document): Promise<Part[]> {
  const parts: Part[] = [];
  const sidePanelSelectors = [
    '[class*="side-panel"]',
    '[class*="file-preview"]',
    '[class*="artifact-panel"]',
    '[class*="sandbox"]',
    '[class*="preview-panel"]',
    '.chat-sidebar',
    '[data-testid*="side"]',
    '[data-testid*="preview"]',
  ];
  
  for (const selector of sidePanelSelectors) {
    const panels = doc.querySelectorAll(selector);
    for (const panel of panels) {
      const text = panel.textContent?.trim();
      if (text && text.length > 50 && /```|\.md|function|class|import|def |const |# /.test(text)) {
        parts.push({ 
          type: "text", 
          markdown: `**Side panel content:**\n\n${text}` 
        });
      }
    }
  }
  return parts;
}

function extractKimiAttachments(doc: Document): Attachment[] {
  return extractAttachmentsFromDocument(doc);
}

function getKimiAuthContext(doc: Document): string | null {
  try {
    const userData = localStorage.getItem("user_info") || localStorage.getItem("user");
    if (userData) {
      const parsed = JSON.parse(userData);
      return parsed.userId || parsed.id || parsed.user_id || null;
    }
  } catch {
    // Ignore missing storage.
  }
  
  try {
    const userData = sessionStorage.getItem("user_info") || sessionStorage.getItem("user");
    if (userData) {
      const parsed = JSON.parse(userData);
      return parsed.userId || parsed.id || parsed.user_id || null;
    }
  } catch {
    // Ignore missing storage.
  }
  
  const html = doc.documentElement.innerHTML;
  const patterns = [
    /userId["']?\s*[:=]\s*["']([^"']+)["']/i,
    /user_id["']?\s*[:=]\s*["']([^"']+)["']/i,
    /"id"\s*:\s*"([^"]+)"[^}]*"avatar"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  
  return null;
}

function fetchKimiListFromDOM(limit: number): Attachment[] {
  return [];
}

function extractKimiListFromDOM(limit: number, offset = 0) {
  const items: Array<{ id: string; title: string; url: string; createdAt: string }> = [];
  const seen = new Set<string>();
  const sidebar = document.querySelector('.chat-sidebar, .conversation-list, .sidebar, [class*="sidebar"], .chat-history, .history-list');
  const itemSelectors = [
    '[data-conversation-id]',
    '[data-id]',
    '.chat-item',
    '.conversation-item',
    '.history-item',
    '[class*="conversation"]',
    '[class*="chat-item"]',
  ];

  const roots = sidebar ? [sidebar, document] : [document];
  for (const root of roots) {
    for (const selector of itemSelectors) {
      for (const el of Array.from(root.querySelectorAll(selector))) {
        const id = el.getAttribute("data-conversation-id") || el.getAttribute("data-id") || el.id;
        if (!id || seen.has(id) || id.includes("sidebar") || id.includes("menu")) continue;
        seen.add(id);
        const title = el.querySelector('.title, .name, [class*="title"], [class*="name"]')?.textContent?.trim() || el.textContent?.trim() || "Untitled";
        items.push({
          id,
          title: title.slice(0, 200),
          url: `https://kimi.com/chat/${id}`,
          createdAt: el.getAttribute("data-created-at") || el.getAttribute("data-time") || new Date().toISOString(),
        });
        if (items.length >= limit + offset) return items.slice(offset, offset + limit);
      }
    }
  }

  return items.slice(offset, offset + limit);
}

export const kimiAdapter: ProviderAdapter = {
  id: "kimi",
  match: (u) => /(^|\.)kimi\.com$/.test(u.hostname),
  isFullyExpandedView: (u) => /\/share\//.test(u.pathname),
  
  getTitle(doc) {
    const fromTitle = doc.title.replace(/\s*[-–|]\s*Kimi.*$/i, "").trim();
    if (fromTitle) return fromTitle;
    
    const fromName = doc.querySelector(".chat-name")?.textContent?.trim();
    return fromName || "Untitled conversation";
  },
  
  async expandAll(doc) {
    await expandUntilStable(doc, [
      'button[aria-expanded="false"]',
      'div[class*="thinking"] button',
      'div[class*="reason"] button',
      'button[class*="expand"]',
      '[class*="collapse"] button',
      '[class*="code-execution"] button',
      '[class*="sandbox"] button',
      '[class*="run-code"] button',
    ]);

    // Expand code-fold buttons with language labels
    for (const btn of doc.querySelectorAll<HTMLElement>('main button, [class*="message"] button, [class*="chat"] button')) {
      const t = (btn.textContent || "").trim();
      if (t.length > 0 && t.length < 25 && /^[a-zA-Z][\w#+.]{0,20}$/.test(t) &&
          !/^(edit|copy|share|delete|remove|close|pin|mute|rename|archive|settings)$/i.test(t)) {
        try { btn.click(); } catch {}
      }
    }
  },
  
  async extract(doc) {
    logger.debug("Starting Kimi extraction", { url: doc.location?.href || "unknown" });
    
    const messages: Message[] = [];
    const allAttachments: Attachment[] = [];
    const turns = Array.from(doc.querySelectorAll(".chat-content-item-user, .chat-content-item-assistant, .message-item, [class*='message']"));
    logger.debug(`Found ${turns.length} Kimi turns`);
    
    for (const el of turns) {
      const isUser = el.classList.contains("chat-content-item-user") || 
                     el.classList.contains("user-message") ||
                     el.getAttribute("data-role") === "user";
      
      const role = isUser ? "user" : "assistant";
      let body = el.querySelector(".markdown-container, .message-content, .content, [class*='markdown'], [class*='content']") ?? el;
      
      let parts = filterUiChromeParts(nodeToParts(body));
      
      const thinking = el.querySelector('[class*="thinking"], [class*="reason"], [class*="reasoning"]');
      if (thinking && thinking !== body) {
        const t = thinking.textContent?.trim();
        if (t) {
          parts.unshift({ type: "thinking", markdown: t });
        }
      }
      
      const iframeParts = await extractIframeContent(el);
      parts.push(...iframeParts);
      
      const msgAttachments = extractAttachmentsFromElement(el).filter(
        (a) => !/icon-cache|kimi-web-img\.moonshot\.cn\/prod-data/.test(a.url)
      );
      allAttachments.push(...msgAttachments);
      
      if (msgAttachments.length > 0) {
        parts.push({ type: "text", markdown: msgAttachments.map((a) => `**Attachment:** [${a.name}](${a.url})`).join("\n") });
      }
      
      if (parts.length) {
        messages.push({ role, parts, createdAt: readTimestamp(el) });
      }
    }
    
    const sidePanelParts = await extractSidePanelContent(doc);
    if (sidePanelParts.length) {
      const lastAssistant = messages.findLastIndex((m) => m.role === "assistant");
      if (lastAssistant >= 0) {
        messages[lastAssistant].parts.push(...sidePanelParts);
      } else {
        messages.push({ role: "assistant", parts: sidePanelParts, createdAt: new Date().toISOString() });
      }
    }
    
    const docAttachments = extractKimiAttachments(doc);
    const allAttachmentUrls = new Set(allAttachments.map((a) => a.url));
    const missingAttachments = docAttachments.filter((a) => !allAttachmentUrls.has(a.url));
    
    if (missingAttachments.length > 0 && messages.length > 0) {
      messages[messages.length - 1].parts.push({
        type: "text",
        markdown: missingAttachments.map((a) => `**Attachment:** [${a.name}](${a.url})`).join("\n"),
      });
    }
    
    logger.debug(`Kimi extraction complete: ${messages.length} messages, ${docAttachments.length} attachments`);
    return messages;
  },

  supportsBulk: true,

  getOrgId(doc) {
    return getKimiAuthContext(doc);
  },

  getAuthToken(doc) {
    return getKimiAuthContext(doc);
  },

  async fetchList(authContext: string, limit: number, offset: number) {
    logger.debug("Kimi fetchList", { limit, offset });
    
    try {
      const url = `https://kimi.com/api/conversations?limit=${limit}&offset=${offset}`;
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-user-id": authContext || "",
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        return {
          items: (data.conversations || []).map((item: any) => ({
            id: item.id,
            title: item.title || "Untitled",
            url: `https://kimi.com/chat/${item.id}`,
            createdAt: item.createdAt || item.created_at || new Date().toISOString(),
            updatedAt: item.updatedAt || item.updated_at,
          })),
          nextOffset: data.hasMore || data.next_offset ? offset + limit : undefined,
          total: data.total || data.conversations?.length || 0,
        };
      }
    } catch (err: any) {
      logger.warn("Kimi API fetchList failed, falling back to DOM", err);
    }
    
    const items = extractKimiListFromDOM(limit, offset);
    return {
      items,
      nextOffset: items.length >= limit ? offset + limit : undefined,
      total: items.length,
    };
  },

  async fetchDetail(authContext: string, conversationId: string) {
    logger.debug("Kimi fetchDetail", { conversationId });
    
    try {
      const url = `https://kimi.com/api/conversations/${conversationId}`;
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          accept: "application/json",
          "x-user-id": authContext || "",
        },
      });
      
      if (response.ok) {
        return await response.json();
      }
    } catch (err: any) {
      logger.warn("Kimi API fetchDetail failed, falling back to DOM", err);
    }
    
    if (window.location.href.includes(`/chat/${conversationId}`)) {
      const messages = await this.extract(document);
      return {
        id: conversationId,
        title: this.getTitle(document),
        messages,
        url: window.location.href,
        createdAt: new Date().toISOString(),
      };
    }
    
    throw new Error(`Cannot fetch Kimi conversation detail for ${conversationId} without an open conversation tab`);
  },

  async parseBulkData(data: any, options: any = {}) {
    logger.debug("Kimi parseBulkData", { hasData: !!data });
    
    const messages: Message[] = [];
    const attachments: Attachment[] = [];
    const warnings: string[] = [];
    
    const rawMessages = Array.isArray(data?.messages)
      ? data.messages
      : Array.isArray(data?.chat_messages)
        ? data.chat_messages
        : [];
    
    for (const msg of rawMessages) {
      const role = msg.role === "user" || msg.sender === "human" ? "user" : "assistant";
      let content = msg.content || msg.text || msg.message || "";
      const extracted = extractAttachmentsFromText(String(content));
      if (options.saveAttachments) attachments.push(...extracted);
      if (extracted.length && options.saveAttachments) {
        content += "\n\n" + extracted.map((a) => `**Attachment:** [${a.name}](${a.url})`).join("\n");
      }
      
      messages.push({
        role,
        parts: [{ type: "text", markdown: content }],
        createdAt: msg.createdAt || msg.created_at || msg.timestamp,
      });
    }
    
    if (!messages.length && typeof data === "string") {
      messages.push({ role: "assistant", parts: [{ type: "text", markdown: data }], createdAt: new Date().toISOString() });
    }
    
    if (options.saveAttachments && typeof document !== "undefined") {
      attachments.push(...extractKimiAttachments(document));
    }
    
    const seenAttachments = new Set<string>();
    const deduped = attachments.filter((a) => {
      if (seenAttachments.has(a.url)) return false;
      seenAttachments.add(a.url);
      return true;
    });
    
    const currentUrl = typeof window !== "undefined" ? window.location.href : "";
    return {
      title: data?.title || (typeof document !== "undefined" ? this.getTitle(document) : "") || "Kimi conversation",
      url: data?.url || currentUrl || `https://kimi.com/chat/${data?.id || ""}`,
      chatId: data?.id || data?.conversationId,
      providerModel: data?.model || data?.providerModel,
      messages,
      attachments: deduped,
      warnings,
    };
  },

  extractAttachments(doc) {
    return extractKimiAttachments(doc);
  },
};
