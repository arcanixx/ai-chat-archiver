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

  async expandAll(doc, signal?: AbortSignal) {
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

    // Step 1: quick scroll to bottom to trigger lazy load and find maxKey
    for (let i = 0; i < 3; i++) {
      signal?.throwIfAborted();
      try { container.scrollTop = container.scrollHeight; } catch {}
      await sleep(200);
    }

    // Ensure we're at top before the staging pass
    signal?.throwIfAborted();
    try { container.scrollTop = 0; } catch {}
    await sleep(200);

    const allKeyEls = doc.querySelectorAll('[data-virtual-list-item-key]');
    const keys = Array.from(allKeyEls)
      .map((el) => parseInt(el.getAttribute("data-virtual-list-item-key") || "0"))
      .filter((k) => k > 0);

    const maxKey = keys.length > 0 ? Math.max(...keys) : 0;
    if (maxKey === 0) return;

    // Step 2: single pass — stage scroll from top to bottom, capture in each stage
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

    const totalHeight = container.scrollHeight || 1;
    const numStages = Math.min(Math.max(Math.ceil(maxKey / 5), 3), 40);
    const stageSize = totalHeight / numStages;

    // Start from top (stage 0 = top), go down to bottom — check signal between stages
    for (let stage = 0; stage <= numStages; stage++) {
      signal?.throwIfAborted();
      try { container.scrollTop = Math.min(stage * stageSize, container.scrollHeight); } catch {}
      await sleep(300);
      snapshot();
      if (seenKeys.size >= maxKey) break;
    }

    // Final snapshot at bottom (in case virtual list load is async)
    if (seenKeys.size < maxKey) {
      signal?.throwIfAborted();
      try { container.scrollTop = container.scrollHeight; } catch {}
      await sleep(300);
      snapshot();
    }

    if (msgByKey.size > 0) {
      const sortedKeys = Array.from(msgByKey.keys()).sort((a, b) => a - b);
      virtualScrollCache = {
        messages: sortedKeys.map((k) => msgByKey.get(k)!),
        keyOrder: sortedKeys,
      };
    }
  },

  async extract(doc) {
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
