import { expandUntilStable, nodeToParts, readTimestamp, type ProviderAdapter } from "./base";
import { extractAttachmentsFromDocument } from "../core/attachments";
import type { Message } from "../core/types";

export const grokAdapter: ProviderAdapter = {
  id: "grok",
  match: (u) => u.hostname.endsWith("grok.com") || u.hostname.endsWith("x.ai"),
  isFullyExpandedView: (u) => u.pathname.startsWith("/share/"),
  
  getTitle(doc) {
    const t = doc.title.replace(/\s*[-–|]\s*Grok.*$/i, "").trim();
    return t || "Untitled conversation";
  },
  
  async expandAll(doc, _signal?: AbortSignal) {
    await expandUntilStable(doc, [
      'button[aria-label*="Show more" i]',
      'button[aria-expanded="false"]'
    ]);
  },
  
  async extract(doc) {
    const messages: Message[] = [];
    const turns = Array.from(doc.querySelectorAll(".message-row, [data-message-author-role]"));
    
    for (const el of turns) {
      const roleRaw = el.getAttribute("data-message-author-role");
      const isUser = roleRaw === "user" || el.className.includes("user");
      const role = isUser ? "user" : "assistant";
      
      const body = el.querySelector(".prose, .markdown") ?? el;
      const parts = nodeToParts(body);
      
      if (parts.length) {
        messages.push({ role, parts, createdAt: readTimestamp(el) });
      }
    }
    
    return messages;
  },

  supportsBulk: true,

  extractAttachments(doc) {
    return extractAttachmentsFromDocument(doc);
  },
};
