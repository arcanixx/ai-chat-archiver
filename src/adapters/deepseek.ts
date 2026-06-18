import { expandUntilStable, nodeToParts, readTimestamp, sleep, type ProviderAdapter } from "./base";
import { extractAttachmentsFromDocument } from "../core/attachments";
import type { Message } from "../core/types";

let virtualScrollCache: { messages: Message[]; keyOrder: number[] } | null = null;

function extractMessageFromDs(el: Element): Message | null {
  const assistantBody = el.querySelector(".ds-markdown.ds-assistant-message-main-content");
  const role = assistantBody ? "assistant" : "user";
  const body = assistantBody ?? el;

  const parts = nodeToParts(body);

  const thinkingEl = el.querySelector('[class*="thinking"], [class*="reason"]');
  if (thinkingEl && thinkingEl !== body) {
    const t = (thinkingEl.textContent ?? "").trim();
    if (t) parts.unshift({ type: "thinking", markdown: t });
  }

  if (!parts.length) return null;
  return { role, parts, createdAt: readTimestamp(el) };
}

export const deepseekAdapter: ProviderAdapter = {
  id: "deepseek",
  match: (u) => u.hostname === "chat.deepseek.com",
  isFullyExpandedView: () => false,

  getTitle(doc) {
    const t = doc.title.replace(/\s*[-–|]\s*DeepSeek.*$/i, "").trim();
    if (t && t.toLowerCase() !== "shared conversation") return t;

    const firstUser = doc.querySelector(".ds-message:not(:has(.ds-assistant-message-main-content))");
    if (firstUser?.textContent) return firstUser.textContent.trim().slice(0, 60);

    return "Untitled conversation";
  },

  async expandAll(doc) {
    virtualScrollCache = null;

    await expandUntilStable(doc, [
      'div[class*="thinking"] button',
      'button[aria-expanded="false"]',
      'div[class*="reason"] button',
    ]);

    const container = doc.querySelector('.ds-virtual-list-items, [class*="virtual"]') ||
                      doc.querySelector('[class*="conversation"]') ||
                      doc.scrollingElement;
    if (!container) return;

    // Step 1: scroll to bottom to find maxKey and trigger lazy load
    for (let i = 0; i < 15; i++) {
      try { container.scrollTop = container.scrollHeight; } catch {}
      await sleep(400);
    }

    const allKeyEls = doc.querySelectorAll('[data-virtual-list-item-key]');
    const keys = Array.from(allKeyEls)
      .map((el) => parseInt(el.getAttribute("data-virtual-list-item-key") || "0"))
      .filter((k) => k > 0);

    const maxKey = keys.length > 0 ? Math.max(...keys) : 0;
    if (maxKey === 0) return;

    // Step 2: collect messages by key — staged scrolling from top to bottom
    const seenKeys = new Set<number>();
    const msgByKey = new Map<number, Message>();

    const snapshot = () => {
      for (const el of doc.querySelectorAll<HTMLElement>(".ds-message, [data-virtual-list-item-key]")) {
        const keyStr = el.getAttribute("data-virtual-list-item-key") ||
                       el.closest("[data-virtual-list-item-key]")?.getAttribute("data-virtual-list-item-key") ||
                       "";
        const key = parseInt(keyStr);
        if (!key || seenKeys.has(key)) continue;

        const dsEl = el.matches(".ds-message") ? el : el.querySelector<HTMLElement>(".ds-message");
        if (!dsEl) continue;

        const msg = extractMessageFromDs(dsEl);
        if (msg) {
          seenKeys.add(key);
          msgByKey.set(key, msg);
        }
      }
    };

    // Scroll incrementally in stages — each stage reveals a new batch of keys
    const totalHeight = container.scrollHeight || 1;
    const numStages = Math.min(Math.max(Math.ceil(maxKey / 3), 3), 30);
    const stageSize = totalHeight / numStages;

    for (let stage = 0; stage <= numStages; stage++) {
      try { container.scrollTop = Math.min(stage * stageSize, container.scrollHeight); } catch {}
      await sleep(500);
      snapshot();
      if (seenKeys.size >= maxKey) break;
    }

    // Final snapshot at the very bottom
    try { container.scrollTop = container.scrollHeight; } catch {}
    await sleep(500);
    snapshot();

    // Targeted fill — if still missing keys, seek each missing key by proportional position
    if (seenKeys.size < maxKey) {
      for (let key = 1; key <= maxKey; key++) {
        if (seenKeys.has(key)) continue;
        const target = (key / maxKey) * container.scrollHeight;
        try { container.scrollTop = target; } catch {}
        await sleep(300);
        snapshot();
        if (seenKeys.size >= maxKey) break;
      }
    }

    if (msgByKey.size > 0) {
      const sortedKeys = Array.from(msgByKey.keys()).sort((a, b) => a - b);
      virtualScrollCache = {
        messages: sortedKeys.map((k) => msgByKey.get(k)!),
        keyOrder: sortedKeys,
      };
    }
  },

  extract(doc) {
    if (virtualScrollCache) {
      const cache = virtualScrollCache;
      virtualScrollCache = null;
      return cache.messages;
    }

    const messages: Message[] = [];
    const turns = Array.from(doc.querySelectorAll(".ds-message"));

    for (const el of turns) {
      const msg = extractMessageFromDs(el);
      if (msg) messages.push(msg);
    }

    return messages;
  },

  supportsBulk: true,

  extractAttachments(doc) {
    return extractAttachmentsFromDocument(doc);
  },
};
