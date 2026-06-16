import { expandUntilStable, nodeToParts, readTimestamp, type ProviderAdapter } from "./base";
import type { Message } from "../core/types";

export const deepseekAdapter: ProviderAdapter = {
  id: "deepseek",
  match: (u) => u.hostname === "chat.deepseek.com",
  isFullyExpandedView: (u) => u.pathname.startsWith("/share/"),
  
  getTitle(doc) {
    const t = doc.title.replace(/\s*[-–|]\s*DeepSeek.*$/i, "").trim();
    if (t && t.toLowerCase() !== "shared conversation") return t;
    
    const firstUser = doc.querySelector(".ds-message:not(:has(.ds-assistant-message-main-content))");
    if (firstUser?.textContent) return firstUser.textContent.trim().slice(0, 60);
    
    return "DeepSeek conversation";
  },
  
  async expandAll(doc) {
    // First, scroll to bottom multiple times to trigger lazy loading of older messages
    const main = doc.querySelector("main") ?? doc.scrollingElement ?? doc.body;
    for (let i = 0; i < 8; i++) {
      main.scrollTop = main.scrollHeight;
      await new Promise((r) => setTimeout(r, 800));
      // Check if "Load more" / "Show earlier" button exists and click it
      const loadMoreBtn = Array.from(doc.querySelectorAll<HTMLElement>("button")).find((btn) => {
        const txt = btn.textContent?.trim().toLowerCase() || "";
        return txt.includes("load more") || txt.includes("show earlier") || txt.includes("更多") || txt.includes("加载更多");
      });
      if (loadMoreBtn) {
        loadMoreBtn.click();
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    // Then expand thinking/reasoning sections
    await expandUntilStable(doc, [
      'div[class*="thinking"] button',
      'button[aria-expanded="false"]',
      'div[class*="reason"] button',
    ]);
  },
  
  extract(doc) {
    const messages: Message[] = [];
    const turns = Array.from(doc.querySelectorAll(".ds-message"));
    
    for (const el of turns) {
      const assistantBody = el.querySelector(".ds-markdown.ds-assistant-message-main-content");
      const role = assistantBody ? "assistant" : "user";
      const body = assistantBody ?? el;
      
      const parts = nodeToParts(body);
      
      const thinkingEl = el.querySelector('[class*="thinking"], [class*="reason"]');
      if (thinkingEl && thinkingEl !== body) {
        const t = (thinkingEl.textContent ?? "").trim();
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