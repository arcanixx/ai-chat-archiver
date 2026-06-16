import { expandUntilStable, nodeToParts, readTimestamp, filterUiChromeParts, type ProviderAdapter } from "./base";
import type { Message } from "../core/types";

export const kimiAdapter: ProviderAdapter = {
  id: "kimi",
  match: (u) => /(^|\.)kimi\.com$/.test(u.hostname),
  isFullyExpandedView: (u) => /\/share\//.test(u.pathname),
  
  getTitle(doc) {
    const fromTitle = doc.title.replace(/\s*[-–|]\s*Kimi.*$/i, "").trim();
    if (fromTitle) return fromTitle;
    
    const fromName = doc.querySelector(".chat-name")?.textContent?.trim();
    return fromName || "Kimi conversation";
  },
  
  async expandAll(doc) {
    await expandUntilStable(doc, [
      'button[aria-expanded="false"]',
      'div[class*="thinking"] button',
      'div[class*="reason"] button',
    ]);
  },
  
  extract(doc) {
    const messages: Message[] = [];
    const turns = Array.from(doc.querySelectorAll(".chat-content-item-user, .chat-content-item-assistant"));
    
    for (const el of turns) {
      const role = el.classList.contains("chat-content-item-user") ? "user" : "assistant";
      
      const body = el.querySelector(".markdown-container") ?? el;
      
      let parts = filterUiChromeParts(nodeToParts(body));
      
      const thinking = el.querySelector('[class*="thinking"], [class*="reason"]');
      if (thinking && thinking !== body) {
        const t = thinking.textContent?.trim();
        if (t) {
          parts.unshift({ type: "thinking", markdown: t });
        }
      }
      
      if (parts.length) {
        messages.push({ role, parts, createdAt: readTimestamp(el) });
      }
    }
    
    return messages;
  },
};
