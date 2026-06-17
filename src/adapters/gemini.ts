import { expandUntilStable, nodeToParts, readTimestamp, type ProviderAdapter } from "./base";
import { extractAttachmentsFromDocument } from "../core/attachments";
import type { Attachment, Message, Part } from "../core/types";

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  match: (u) => u.hostname === "gemini.google.com",
  isFullyExpandedView: (u) => u.pathname.startsWith("/share/"),
  
  getTitle(doc) {
    const raw = doc.title.replace(/^\u200e/, "").trim();
    return raw.replace(/\s*[-–|]\s*Google Gemini.*$/i, "").trim() || "Untitled conversation";
  },
  
  async expandAll(doc) {
    await expandUntilStable(doc, [
      '[data-test-id="expandable-section-toggle"][aria-expanded="false"]',
      'button[aria-label*="Show" i]',
      'button[aria-label*="Expand" i]',
      "thinking-overlay button",
    ]);
  },
  
  extract(doc) {
    const messages: Message[] = [];
    const turns = [
      ...Array.from(doc.querySelectorAll("user-query")).map((el) => ({ role: "user" as const, el })),
      ...Array.from(doc.querySelectorAll("response-container")).map((el) => ({ role: "assistant" as const, el })),
    ].sort((a, b) => (a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1));
    
    for (const { role, el } of turns) {
      let body: Element;
      if (role === "user") {
        body = el.querySelector(".query-text") || el.querySelector("user-query-content") || el;
      } else {
        body = el.querySelector(".markdown-main-panel") || el.querySelector("message-content") || el;
      }
      
      const parts = nodeToParts(body);
      
      const codeBlocks = el.querySelectorAll("code-block");
      if (codeBlocks.length && role === "assistant") {
        patchCodeLangs(parts, codeBlocks);
      }
      
      const thinking = el.querySelector("thinking-overlay");
      if (thinking && thinking.textContent?.trim()) {
        parts.unshift({ type: "thinking", markdown: thinking.textContent.trim() });
      }
      
      if (parts.length) {
        messages.push({ role, parts, createdAt: readTimestamp(el) });
      }
    }
    
    return messages;
  },

  getAuthToken(doc) {
    return getGeminiAuthToken(doc)?.sid || null;
  },

  supportsBulk: true,

  async fetchList(authContext: string, limit: number, offset: number) {
    const sid = authContext;
    if (!sid) throw new Error("SID required for Gemini bulk");

    const response = await chrome.runtime.sendMessage({
      action: "gemini-fetch-list",
      payload: { sid, limit, offset },
    });

    if (!response?.success) {
      throw new Error(response?.error || "Gemini fetch list failed");
    }

    const data = response.data;
    return {
      items: (data.conversations || []).map((item: any) => ({
        id: String(item.id).replace(/^c_/, ""),
        title: item.title || "Untitled",
        url: `https://gemini.google.com/app/${item.id}`,
        createdAt: new Date(item.timestamp || Date.now()).toISOString(),
      })),
      nextOffset: data.nextPageToken ? offset + limit : undefined,
      total: data.conversations?.length || 0,
    };
  },

  async fetchDetail(authContext: string, conversationId: string) {
    const sid = authContext;
    if (!sid) throw new Error("SID required for Gemini bulk");

    const response = await chrome.runtime.sendMessage({
      action: "gemini-fetch-detail",
      payload: { sid, conversationId },
    });

    if (!response?.success) {
      throw new Error(response?.error || "Gemini fetch detail failed");
    }

    return response.data;
  },

  async parseBulkData(data: any, options: any = {}) {
    const messages: Message[] = [];
    const attachments: Attachment[] = [];
    const rawMessages = data.messages || [];

    for (const msg of rawMessages) {
      const role = msg.role === "user" ? "user" : "assistant";
      let content = msg.content || "";

      if (msg.images && msg.images.length > 0) {
        for (const img of msg.images) {
          if (options.saveAttachments) {
            attachments.push({
              name: img.fileName || `image-${attachments.length + 1}.jpg`,
              url: img.sourceUrl || img.resolvedUrl || img.dataUrl || "",
              mime: img.mimeType || "image/jpeg",
              data: img.dataUrl || "",
            });
          }
          content += `\n\n![${img.fileName || "image"}](${img.resolvedUrl || img.sourceUrl || img.dataUrl || ""})`;
        }
      }

      if (msg.documents && msg.documents.length > 0) {
        for (const doc of msg.documents) {
          const docContent = doc.contentMarkdown || doc.sections?.map((s: any) => s.content).join("\n\n") || "";
          if (options.saveAttachments && docContent) {
            attachments.push({
              name: doc.title || `document-${attachments.length + 1}.md`,
              url: `data:text/plain;base64,${btoa(unescape(encodeURIComponent(docContent)))}`,
              mime: "text/markdown",
              data: docContent,
            });
          }
          content += `\n\n**Document:** ${doc.title}\n\n${docContent}`;
        }
      }

      messages.push({
        role,
        parts: [{ type: "text", markdown: content }],
        createdAt: msg.timestamp ? new Date(msg.timestamp).toISOString() : undefined,
      });
    }

    return {
      title: data.title || "Gemini conversation",
      url: data.url || `https://gemini.google.com/app/${String(data.id || "").replace(/^c_/, "")}`,
      chatId: data.id ? String(data.id).replace(/^c_/, "") : undefined,
      messages,
      attachments,
      warnings: [],
    };
  },

  extractAttachments(doc) {
    return extractAttachmentsFromDocument(doc);
  },
};

function getGeminiAuthToken(doc: Document): { sid: string; at: string } | null {
  try {
    // Read credentials from page's sessionStorage (set by Gemini when authenticated)
    const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("geminiauth") : null;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.sid && parsed?.at) {
          return { sid: String(parsed.sid), at: String(parsed.at) };
        }
      } catch { /* ignore parse failure */ }
    }
    // Fallback: try to extract from page meta tags or cookies
    const meta = doc.querySelector('meta[name="g-token"]');
    if (meta?.getAttribute("content")) {
      return { sid: meta.getAttribute("content") || "", at: "" };
    }
  } catch {
    return null;
  }
  return null;
}

function patchCodeLangs(parts: Part[], blocks: NodeListOf<Element>) {
  const codeParts = parts.filter((p) => p.type === "code") as Extract<Part, { type: "code" }>[];
  blocks.forEach((b, i) => {
    if (!codeParts[i] || codeParts[i].lang) return;
    const header = b.querySelector('[class*="code-block-decoration"], header, .header');
    const lang = (header?.textContent || "").trim().split(/\s+/)[0].toLowerCase();
    if (lang && /^[a-z0-9+#-]{1,20}$/.test(lang)) {
      codeParts[i].lang = lang;
    }
  });
}
