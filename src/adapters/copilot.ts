import { expandUntilStable, nodeToParts, readTimestamp, type ProviderAdapter } from "./base";
import { extractAttachmentsFromDocument } from "../core/attachments";
import type { Message } from "../core/types";

export const copilotAdapter: ProviderAdapter = {
  id: "copilot",
  match: (u) => u.hostname === "copilot.microsoft.com" || u.hostname === "www.bing.com",
  isFullyExpandedView: (u) => u.searchParams.has("convid") || u.pathname.startsWith("/share/"),
  
  getTitle(doc) {
    const t = doc.title.replace(/\s*[-–|]\s*Copilot.*$/i, "").trim();
    return t || "Untitled conversation";
  },
  
  async expandAll(doc) {
    await expandUntilStable(doc, [
      'button[aria-expanded="false"]'
    ]);
  },
  
  extract(doc) {
    const messages: Message[] = [];
    const turns = Array.from(doc.querySelectorAll("cib-chat-turn, .chat-turn"));
    
    for (const el of turns) {
      const role = el.className.includes("user") || el.getAttribute("data-role") === "user" ? "user" : "assistant";
      const parts = nodeToParts(el);
      
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
