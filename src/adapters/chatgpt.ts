import { expandUntilStable, nodeToParts, readTimestamp, type ProviderAdapter } from "./base";
import type { Message } from "../core/types";

export const chatgptAdapter: ProviderAdapter = {
  id: "chatgpt",
  match: (u) => u.hostname === "chatgpt.com" || u.hostname === "chat.openai.com",
  
  getTitle(doc) {
    return (
      doc.querySelector('nav a[aria-current="page"]')?.textContent?.trim() ||
      doc.title.replace(/\s*[-–|]\s*ChatGPT.*$/i, "").trim() ||
      "ChatGPT conversation"
    );
  },
  
  async expandAll(doc) {
    await expandUntilStable(doc, [
      'button[aria-expanded="false"]',
      'button[aria-label*="Show" i]',
    ]);
  },
  
  extract(doc) {
    const messages: Message[] = [];
    const turns = doc.querySelectorAll("[data-message-author-role]");
    
    for (const el of Array.from(turns)) {
      const role = (el.getAttribute("data-message-author-role") as Message["role"]) || "assistant";
      const body = el.querySelector("[data-message-content], .markdown, .prose") ?? el;
      
      const parts = nodeToParts(body);
      
      if (parts.length) {
        messages.push({ role, parts, createdAt: readTimestamp(el) });
      }
    }
    
    return messages;
  },
};
