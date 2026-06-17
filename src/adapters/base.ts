import { logger } from "../core/logger";
import type { Attachment, BulkConversationItem, Message, Part } from "../core/types";

export interface BulkAdapter {
  getOrgId?(doc: Document): string | null;
  getAuthToken?(doc: Document): string | null;
  supportsBulk?: boolean;
  fetchList?(authContext: string, limit: number, offset: number): Promise<{
    items: BulkConversationItem[];
    nextOffset?: number;
    total?: number;
  }>;
  fetchDetail?(authContext: string, conversationId: string): Promise<any>;
  parseBulkData?(data: any, options?: any): Promise<{
    title: string;
    url: string;
    chatId?: string;
    providerModel?: string;
    messages: Message[];
    attachments?: Attachment[];
    warnings?: string[];
  }>;
  extractAttachments?(doc: Document): Attachment[];
}

export interface ProviderAdapter extends Partial<BulkAdapter> {
  id: string;
  match(url: URL): boolean;
  isFullyExpandedView?(url: URL): boolean;
  getTitle(doc: Document): string;
  detectModel?(doc: Document): string | undefined;
  expandAll(doc: Document): Promise<void>;
  extract(doc: Document): Message[] | Promise<Message[]>;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Check if an element is UI chrome (buttons, icons, etc.) that should be ignored during extraction. */
export function isUiChrome(el: Element): boolean {
  const dataId = el.getAttribute("data-test-id") || el.getAttribute("data-testid") || "";
  if (/copy-button|action-bar|more-menu|thumb-(up|down)|expandable-section-toggle|prompt-copy/.test(dataId)) return true;
  if (el.matches?.("mat-icon, gem-icon, .cdk-visually-hidden")) return true;
  // Only skip buttons that are small/icon-only (no substantial text), not content-bearing ones
  if (el.tagName === "BUTTON" || el.getAttribute("role") === "button") {
    const text = (el.textContent || "").trim();
    if (text.length <= 2) return true; // icon-only buttons
    if (/^(edit|copy|share|delete|remove|close|\s*)$/i.test(text)) return true;
    return false; // keep buttons with meaningful content
  }
  return false;
}

/** Remove common UI artifact lines (e.g., "Edit", "Copy", "Share") from text parts. */
export function filterUiChromeParts(parts: Part[]): Part[] {
  return parts
    .map((p) => {
      if (p.type !== "text") return p;
      const lines = p.markdown.split("\n");
      const filtered = lines.filter((line) => {
        const trimmed = line.trim();
        return !/^(Edit|Copy|Share|Kopiuj|Udostępnij|Edytuj)$/i.test(trimmed);
      });
      return { ...p, markdown: filtered.join("\n") };
    })
    .filter((p) => {
      if (p.type !== "text") return true;
      return p.markdown.trim().length > 0;
    });
}

export async function clickAll(doc: Document, selectors: string[]): Promise<number> {
  let n = 0;
  logger.debug("Starting clickAll operation", { selectorCount: selectors.length });
  
  for (const sel of selectors) {
    let nodes: NodeListOf<Element>;
    try {
      nodes = doc.querySelectorAll(sel);
      logger.debug("Processing selector", { selector: sel, nodeCount: nodes.length });
    } catch (e: any) {
      logger.warn("Invalid selector in clickAll", { selector: sel, error: e.message });
      continue;
    }
    
    for (const el of Array.from(nodes)) {
      try {
        (el as HTMLElement).click();
        n++;
      } catch (e: any) {
        logger.warn("Failed to click element", { selector: sel, error: e.message });
      }
    }
  }
  
  if (n) {
    logger.debug("Clicked elements, waiting", { clickCount: n });
    await sleep(120);
  }
  
  logger.debug("ClickAll operation completed", { totalClicks: n });
  return n;
}

export async function expandUntilStable(doc: Document, selectors: string[], maxIter = 8) {
  logger.debug("Starting expandUntilStable", { selectors, maxIter });
  let prev = -1;
  
  for (let i = 0; i < maxIter; i++) {
    try {
      const main = doc.querySelector("main") ?? doc.scrollingElement ?? doc.body;
      if (!main) {
        logger.warn("No main element found for scrolling");
        break;
      }
      
      logger.debug("Expansion iteration", { iteration: i });
      main.scrollTop = 0;
      await sleep(150);
      main.scrollTop = main.scrollHeight;
      await sleep(150);
      
      const before = doc.body.innerHTML.length;
      logger.debug("Before click", { htmlLength: before });
      
      await clickAll(doc, selectors);
      await sleep(200);
      
      const after = doc.body.innerHTML.length;
      logger.debug("After click", { htmlLength: after });
      
      if (after === before && before === prev) {
        logger.debug("Stability reached", { iteration: i, htmlLength: after });
        break;
      }
      prev = before;
    } catch (e: any) {
      logger.error("Error in expandUntilStable iteration", { iteration: i, error: e.message });
      break;
    }
  }
  
  try {
    const detailsOpened = doc.querySelectorAll("details:not([open])").length;
    if (detailsOpened > 0) {
      doc.querySelectorAll("details:not([open])").forEach((d) => ((d as HTMLDetailsElement).open = true));
      logger.debug("Opened details elements", { count: detailsOpened });
    }
  } catch (e: any) {
    logger.error("Failed to open details elements", { error: e.message });
  }
  
  logger.debug("expandUntilStable completed");
}

export function readTimestamp(el: Element): string | undefined {
  const t = el.querySelector("time[datetime]");
  if (t) {
    const iso = t.getAttribute("datetime") || (t as HTMLElement).title;
    if (iso) return iso;
  }
  const label = el.getAttribute("aria-label") || "";
  const m = /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?)/.exec(label);
  if (m) return m[1];
  return undefined;
}

export function nodeToParts(root: Element): Part[] {
  logger.debug("Starting nodeToParts conversion", { 
    tagName: root.tagName, 
    childCount: root.childNodes.length 
  });
  
  const parts: Part[] = [];
  const buf: string[] = [];
  
  const flush = () => {
    const t = buf.join("").replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (t) parts.push({ type: "text", markdown: t });
    buf.length = 0;
  };
  
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      buf.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    
    const el = node as HTMLElement;
    if (isUiChrome(el)) return;
    
    const tag = el.tagName.toLowerCase();
    
    if (tag === "pre") {
      flush();
      const codeEl = el.querySelector("code");
      const lang = detectLang(codeEl ?? el);
      const code = (codeEl ?? el).textContent ?? "";
      parts.push({ type: "code", lang, code });
      logger.debug("Added code block", { lang, codeLength: code.length });
      return;
    }
    
    if (tag === "code") {
      buf.push("`" + (el.textContent ?? "") + "`");
      return;
    }
    
    if (tag === "br") {
      buf.push("\n");
      return;
    }
    
    if (tag === "img") {
      flush();
      const imgEl = el as HTMLImageElement;
      const src = imgEl.src;
      if (src && !src.startsWith("data:image/svg")) {
        parts.push({ type: "image", src, alt: imgEl.alt });
        logger.debug("Added image", { src, alt: imgEl.alt });
      }
      return;
    }
    
    if (tag === "a") {
      const aEl = el as HTMLAnchorElement;
      const href = aEl.href;
      const txt = (el.textContent ?? "").trim();
      if (href && txt) {
        buf.push(`[${txt}](${href})`);
        logger.debug("Added link", { text: txt, href });
      }
      return;
    }
    
    if (tag === "strong" || tag === "b") {
      buf.push("**");
      for (const c of Array.from(el.childNodes)) walk(c);
      buf.push("**");
      return;
    }
    
    if (tag === "em" || tag === "i") {
      buf.push("_");
      for (const c of Array.from(el.childNodes)) walk(c);
      buf.push("_");
      return;
    }
    
    if (/^h[1-6]$/.test(tag)) {
      flush();
      const level = Number(tag[1]);
      buf.push("\n" + "#".repeat(level) + " ");
      for (const c of Array.from(el.childNodes)) walk(c);
      buf.push("\n");
      flush();
      logger.debug("Added heading", { level, text: buf.join("") });
      return;
    }
    
    if (tag === "li") {
      buf.push("\n- ");
      for (const c of Array.from(el.childNodes)) walk(c);
      return;
    }
    
    if (tag === "table") {
      flush();
      parts.push({ type: "text", markdown: htmlTableToMd(el as HTMLTableElement) });
      logger.debug("Added table", { html: htmlTableToMd(el as HTMLTableElement) });
      return;
    }
    
    if (tag === "ul" || tag === "ol" || tag === "blockquote" || tag === "p" || tag === "div") {
      for (const c of Array.from(el.childNodes)) walk(c);
      buf.push("\n\n");
      return;
    }
    
    for (const c of Array.from(el.childNodes)) walk(c);
  };
  
  try {
    for (const c of Array.from(root.childNodes)) walk(c);
    flush();
    
    const finalParts = mergeAdjacentText(parts);
    logger.debug("NodeToParts completed", { 
      originalParts: parts.length,
      finalParts: finalParts.length,
      partTypes: finalParts.map(p => p.type)
    });
    
    return finalParts;
  } catch (e: any) {
    logger.error("Error in nodeToParts", { error: e.message, stack: e.stack });
    flush();
    return mergeAdjacentText(parts);
  }
}

function detectLang(el: Element): string | undefined {
  const cls = el.className || "";
  const m = /language-([\w+-]+)/.exec(cls);
  if (m) return m[1];
  const d = el.getAttribute("data-language") || el.getAttribute("data-lang");
  return d ?? undefined;
}

function mergeAdjacentText(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (p.type === "text" && last && last.type === "text") {
      last.markdown = (last.markdown + "\n\n" + p.markdown).replace(/\n{3,}/g, "\n\n").trim();
    } else {
      out.push(p);
    }
  }
  return out;
}

function htmlTableToMd(tbl: HTMLTableElement): string {
  try {
    logger.debug("Converting table to Markdown", { 
      rowCount: tbl.rows.length,
      columnCount: tbl.rows[0]?.cells.length || 0 
    });
    
    const rows = Array.from(tbl.rows).map((r) =>
      Array.from(r.cells).map((c) => (c.textContent ?? "").trim().replace(/\|/g, "\\|"))
    );
    if (!rows.length) {
      logger.debug("Empty table, returning empty string");
      return "";
    }
    
    const header = rows[0];
    const sep = header.map(() => "---");
    const body = rows.slice(1);
    
    const markdown = [header, sep, ...body].map((r) => `| ${r.join(" | ")} |`).join("\n");
    logger.debug("Table conversion completed", { markdown: markdown.slice(0, 100) + "..." });
    
    return markdown;
  } catch (e: any) {
    logger.error("Failed to convert table to Markdown", { error: e.message });
    return "[Error: Could not convert table]";
  }
}

export function extractDomConversationList(doc: Document, limit = 30, offset = 0) {
  const items: BulkConversationItem[] = [];
  const seen = new Set<string>();
  const origin = doc.location?.origin || new URL(doc.URL || "https://example.com").origin;
  const candidateSelectors = [
    "[data-conversation-id]",
    "[data-chat-id]",
    "[data-id]",
    ".conversation-item",
    ".chat-item",
    ".history-item",
    "[class*='conversation-item']",
    "[class*='chat-item']",
    "a[href*='/chat/']",
    "a[href*='/c/']",
    "a[href*='/app/']",
  ];

  for (const selector of candidateSelectors) {
    try {
      for (const el of Array.from(doc.querySelectorAll(selector))) {
        const id = el.getAttribute("data-conversation-id") || el.getAttribute("data-chat-id") || el.getAttribute("data-id") || "";
        const anchor = el.tagName === "A" ? (el as HTMLAnchorElement) : (el.querySelector("a[href]") as HTMLAnchorElement | null);
        const href = anchor?.href || "";
        const url = href || (id ? new URL(`/chat/${encodeURIComponent(id)}`, origin).href : "");
        const resolvedId = id || href.split("/").filter(Boolean).pop() || "";
        const titleEl = el.querySelector(".title, .name, h1, h2, h3, [class*='title'], [class*='name']");
        const title = titleEl?.textContent?.trim() || el.textContent?.trim() || "Untitled";
        if (!resolvedId || seen.has(resolvedId)) continue;
        seen.add(resolvedId);
        items.push({
          id: resolvedId,
          title: title.slice(0, 200),
          url,
          createdAt: el.getAttribute("data-created-at") || el.getAttribute("data-time") || new Date().toISOString(),
          updatedAt: el.getAttribute("data-updated-at") || undefined,
        });
        if (items.length >= limit + offset) return items.slice(offset, offset + limit);
      }
    } catch {
      continue;
    }
  }

  return items.slice(offset, offset + limit);
}
