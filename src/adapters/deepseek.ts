import { expandUntilStable, nodeToParts, readTimestamp, sleep, type ProviderAdapter } from "./base";
import { extractAttachmentsFromDocument } from "../core/attachments";
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
    
    return "Untitled conversation";
  },
  
  async expandAll(doc) {
    const scrollTargets = () => [
      doc.querySelector("main"),
      doc.scrollingElement,
      doc.body,
      doc.querySelector('.ds-conversation'),
      doc.querySelector('[class*="messages"]'),
      doc.querySelector('[class*="chat"]'),
      doc.querySelector('[class*="scroll"]'),
      doc.querySelector('[class*="conversation"]'),
    ].filter(Boolean) as Element[];

    let prevCount = 0;
    for (let i = 0; i < 20; i++) {
      for (const el of scrollTargets()) {
        try { el.scrollTop = 0; await sleep(200); el.scrollTop = el.scrollHeight; } catch {}
      }
      await sleep(400);

      const loadMoreBtn = Array.from(doc.querySelectorAll<HTMLElement>("button, a, [role='button']")).find((btn) => {
        const txt = btn.textContent?.trim().toLowerCase() || "";
        return txt.includes("load more") || txt.includes("show earlier") || txt.includes("load earlier") ||
               txt.includes("więcej") || txt.includes("pokaż więcej") || txt.includes("wyświetl") ||
               txt.includes("更多") || txt.includes("加载更多") || txt.includes("显示更早");
      });
      if (loadMoreBtn) {
        loadMoreBtn.click();
        await sleep(1500);
      }

      const msgCount = doc.querySelectorAll(".ds-message").length;
      if (i > 2 && msgCount === prevCount) break;
      prevCount = msgCount;
    }
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

  supportsBulk: true,

  extractAttachments(doc) {
    return extractAttachmentsFromDocument(doc);
  },
};
