import { expandUntilStable, nodeToParts, readTimestamp, type ProviderAdapter } from "./base";
import type { Message, Part } from "../core/types";

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  match: (u) => u.hostname === "gemini.google.com",
  isFullyExpandedView: (u) => u.pathname.startsWith("/share/"),
  
  getTitle(doc) {
    const raw = doc.title.replace(/^\u200e/, "").trim();
    return raw.replace(/\s*[-–|]\s*Google Gemini.*$/i, "").trim() || "Gemini conversation";
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
};

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
