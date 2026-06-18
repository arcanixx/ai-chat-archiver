/**
 * @file claude.ts
 * @path src/adapters/claude.ts
 * @description Provider adapter for claude.ai — DOM extraction + bulk API mode.
 *   Fixes vs previous version:
 *   1. Artifact DOM extraction rewritten — uses correct selectors for Claude's sidebar panel.
 *   2. parseBulkData now handles `document` content blocks (user-uploaded files).
 *   3. User-uploaded file attachments are saved to a per-conversation subfolder when
 *      `options.saveAttachments` is enabled.
 *   4. Artifact content from bulk API is now emitted as proper `artifact` Parts
 *      (not raw markdown strings) so the serializer renders them correctly.
 * @exports claudeAdapter
 */

import { expandUntilStable, nodeToParts, readTimestamp, sleep, type ProviderAdapter } from "./base";
import { logger } from "../core/logger";
import { extractAttachmentsFromDocument } from "../core/attachments";
import type { Attachment, Message, Part } from "../core/types";

// ─────────────────────────────────────────────────────────────────────────────
// Org-ID helpers (unchanged — working correctly)
// ─────────────────────────────────────────────────────────────────────────────

function getOrgIdFromPage(doc: Document): string | null {
  const html = doc.documentElement.innerHTML;
  const match = html.match(/https:\/\/claude\.ai\/api\/organizations\/([a-f0-9-]{36})/);
  if (match?.[1]) return match[1];

  try {
    const statuses = JSON.parse(sessionStorage.getItem("SSS-cardamom-integration-statuses") || "{}");
    if (statuses?.orgUuid) return statuses.orgUuid;
  } catch {
    // Ignore missing or malformed session storage.
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIME helpers (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

function getExtensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    "text/plain": "txt",
    "text/markdown": "md",
    "text/html": "html",
    "application/json": "json",
    "text/x-python": "py",
    "text/javascript": "js",
    "text/typescript": "ts",
    "text/x-rust": "rs",
    "text/x-c": "c",
    "text/x-cpp": "cpp",
    "text/x-java": "java",
    "text/x-go": "go",
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };
  return map[mime] || mime.split("/").pop() || "txt";
}

function getLanguageFromMime(mime: string): string {
  const map: Record<string, string> = {
    "text/plain": "text",
    "text/markdown": "markdown",
    "text/html": "html",
    "application/json": "json",
    "text/x-python": "python",
    "text/javascript": "javascript",
    "text/typescript": "typescript",
    "text/x-rust": "rust",
    "text/x-c": "c",
    "text/x-cpp": "cpp",
    "text/x-java": "java",
    "text/x-go": "go",
  };
  return map[mime] || mime.split("/").pop() || "text";
}

// ─────────────────────────────────────────────────────────────────────────────
// API enrichment helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extract conversation UUID from Claude chat URL */
function extractConvIdFromUrl(url: string): string | null {
  const m = url.match(/\/chat\/([a-f0-9-]{36})/);
  return m?.[1] || null;
}

/** Cache for attachments extracted from API (used by extractAttachments) */
let _cachedApiAttachments: Attachment[] | null = null;

/**
 * Extract non-text Parts (tool_use, tool_result, artifact, image, attachment)
 * from a Claude API conversation detail response.
 * Skips plain text blocks — we keep DOM text for better formatting.
 */
function extractApiNonTextParts(data: any): {
  parts: Part[];
  attachments: Attachment[];
} {
  const parts: Part[] = [];
  const attachments: Attachment[] = [];
  const artifactMemory: Record<string, { current: string; title: string; type: string; version: number }> = {};

  const chatMessages = data.chat_messages || [];
  for (const msg of chatMessages) {
    for (const content of msg.content || []) {
      if (!content) continue;

      // Tool result
      if (content.type === "tool_result") {
        const result = typeof content.content === "string"
          ? content.content
          : content.content?.[0]?.text || content.text || "";
        if (result) {
          parts.push({ type: "tool_result", name: "tool_result", output: result });
        }
        continue;
      }

      // Tool use (including artifacts)
      if (content.type === "tool_use") {
        const toolName = content.name || "";
        const input = content.input || {};

        if (toolName === "artifacts") {
          const artifactId = input.id || content.id || input.version_uuid || `artifact-${attachments.length + 1}`;
          const command = (input.command || "create") as "create" | "rewrite" | "update";
          const mimeType = input.type || input.textdoc_type || "text/plain";
          const title = input.title || artifactId;

          let contentStr = "";
          const prev = artifactMemory[artifactId]?.current || "";

          if (command === "create" || command === "rewrite") {
            contentStr = typeof input.content === "string"
              ? input.content
              : JSON.stringify(input.content || input, null, 2);
          } else if (command === "update") {
            const oldStr = input.old_str || "";
            const newStr = input.new_str || (typeof input.content === "string" ? input.content : "");
            contentStr = prev.includes(oldStr) ? prev.replace(oldStr, newStr) : `${prev}\n\n/* patch */\n${newStr}`;
          } else {
            contentStr = typeof input.content === "string"
              ? input.content
              : JSON.stringify(input.content || input, null, 2);
          }

          const version = (artifactMemory[artifactId]?.version || 0) + 1;
          artifactMemory[artifactId] = { current: contentStr, title, type: mimeType, version };

          parts.push({
            type: "artifact",
            title: `${title} (v${version})`,
            lang: getLanguageFromMime(mimeType),
            code: contentStr,
          });
          continue;
        }

        // Other tool calls
        parts.push({ type: "tool_use", name: toolName, input });
        continue;
      }

      // User-uploaded document
      if (content.type === "document" || (content.type === "text" && content.source?.type === "file")) {
        const source = content.source || {};
        const fileName = content.name || source.filename || source.file_name || `attachment-${attachments.length + 1}`;
        const mimeType = source.media_type || content.media_type || "application/octet-stream";

        const extractedText = content.extracted_content || content.text || (typeof source.data === "string" ? source.data : null);

        parts.push({ type: "attachment", name: fileName, mime: mimeType });

        if (extractedText) {
          attachments.push({
            name: fileName,
            url: `data:${mimeType};base64,${btoa(unescape(encodeURIComponent(extractedText)))}`,
            mime: mimeType,
            data: extractedText,
          });
        } else if (source.url) {
          attachments.push({ name: fileName, url: source.url, mime: mimeType });
        }
        continue;
      }

      // Image
      if (content.type === "image") {
        const src = content.source?.url ||
          (content.source?.type === "base64"
            ? `data:${content.source.media_type};base64,${content.source.data}`
            : null);
        if (src) {
          parts.push({ type: "image", src, alt: content.alt || "" });
        }
        continue;
      }
    }
  }

  // Final artifact versions as attachments
  for (const [, artifact] of Object.entries(artifactMemory)) {
    const ext = getExtensionFromMime(artifact.type);
    const alreadySaved = attachments.some((a) => a.name.includes(artifact.title));
    if (!alreadySaved) {
      attachments.push({
        name: `${artifact.title}_final.${ext}`,
        url: `data:${artifact.type};base64,${btoa(unescape(encodeURIComponent(artifact.current)))}`,
        mime: artifact.type,
        data: artifact.current,
      });
    }
  }

  return { parts, attachments };
}

/** Standalone Claude API fetch — used by both bulk fetchDetail and extract enrichment */
async function fetchClaudeDetail(orgId: string, conversationId: string): Promise<any> {
  const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { accept: "*/*" },
  });
  if (!response.ok) throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
  return await response.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM artifact extraction — REWRITTEN
//
// Claude renders artifacts in a right-side panel that is NOT a child of the
// assistant message block. Selectors that reliably target it:
//   • [data-testid="artifact-content-wrapper"]  — artifact panel wrapper
//   • [data-testid="artifact-title"]            — title element inside the panel
//   • .artifact-block                           — fallback class (as of 2025-Q4)
//   • div[class*="ArtifactViewer"]              — compiled React class name
//
// For code artifacts the content lives in a <pre><code> inside the panel.
// For React/HTML artifacts we get the raw source from a <code> block.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find all artifact panels in the document and return them as Part[] entries.
 * Called once per extract() invocation and appended to the last assistant message.
 */
function extractDomArtifacts(doc: Document): Part[] {
  logger.debug("[ClaudeAdapter] extractDomArtifacts: scanning document");
  const artifacts: Part[] = [];
  const seen = new Set<string>();

  // Strategy 1 — data-testid selectors (most reliable, least likely to break)
  const wrappers = doc.querySelectorAll<HTMLElement>(
    '[data-testid="artifact-content-wrapper"], [data-testid*="artifact-"]'
  );

  for (const wrapper of Array.from(wrappers)) {
    try {
      const titleEl =
        wrapper.querySelector<HTMLElement>('[data-testid="artifact-title"]') ||
        wrapper.querySelector<HTMLElement>("h3, h4, [class*='title'], [class*='Title']");
      const title = titleEl?.innerText?.trim() || titleEl?.textContent?.trim() || "Artifact";
      const codeEl = wrapper.querySelector<HTMLElement>("pre code, code");
      const code = codeEl?.innerText || codeEl?.textContent || "";
      const lang = codeEl?.className?.match(/language-([\w+-]+)/)?.[1] ?? undefined;

      const key = `${title}::${code.slice(0, 80)}`;
      if (seen.has(key) || !code.trim()) continue;
      seen.add(key);

      artifacts.push({ type: "artifact", title, lang, code });
      logger.debug("[ClaudeAdapter] Found artifact via data-testid", { title, lang, codeLen: code.length });
    } catch (e: any) {
      logger.warn("[ClaudeAdapter] Failed to process artifact wrapper", { error: e.message });
    }
  }

  if (artifacts.length > 0) return artifacts;

  // Strategy 2 — look for the artifact sidebar by its distinct structure:
  // a panel that contains both a title-like element and a <pre><code>
  const panelCandidates = doc.querySelectorAll<HTMLElement>(
    'div[class*="artifact" i], div[class*="Artifact" i], aside[class*="artifact" i]'
  );

  for (const panel of Array.from(panelCandidates)) {
    // Skip tiny panels (nav icons etc.)
    if ((panel.textContent || "").length < 20) continue;
    // Skip panels that are inside an assistant message body (those are card previews, not source)
    if (panel.closest(".font-claude-response")) continue;

    try {
      const titleEl = panel.querySelector<HTMLElement>("h3, h4, [class*='title' i], [class*='Title' i]");
      const title = titleEl?.innerText?.trim() || titleEl?.textContent?.trim() || "Artifact";
      const codeEl = panel.querySelector<HTMLElement>("pre code, code");
      const code = codeEl?.innerText || codeEl?.textContent || "";
      const lang = codeEl?.className?.match(/language-([\w+-]+)/)?.[1] ?? undefined;

      const key = `${title}::${code.slice(0, 80)}`;
      if (seen.has(key) || !code.trim()) continue;
      seen.add(key);

      artifacts.push({ type: "artifact", title, lang, code });
      logger.debug("[ClaudeAdapter] Found artifact via class heuristic", { title, lang });
    } catch (e: any) {
      logger.warn("[ClaudeAdapter] Failed to process panel candidate", { error: e.message });
    }
  }

  if (artifacts.length > 0) return artifacts;

  // Strategy 3 — look for orphan <pre><code> blocks that are NOT inside a message body.
  // These are typically rendered artifact code panels.
  const allPreCode = doc.querySelectorAll<HTMLElement>("pre code");
  for (const codeEl of Array.from(allPreCode)) {
    if (codeEl.closest(".font-claude-response, [data-testid='user-message']")) continue;
    const code = codeEl.innerText || codeEl.textContent || "";
    if (code.length < 50) continue; // skip tiny snippets

    const lang = codeEl.className?.match(/language-([\w+-]+)/)?.[1] ?? undefined;
    // Try to find a nearby title
    const parent = codeEl.closest("div, section, article");
    const titleEl = parent?.querySelector<HTMLElement>("h3, h4, [class*='title' i]");
    const title = titleEl?.textContent?.trim() || (lang ? `${lang} artifact` : "Artifact");

    const key = `${title}::${code.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    artifacts.push({ type: "artifact", title, lang, code });
    logger.debug("[ClaudeAdapter] Found artifact via orphan pre/code", { title, lang });
  }

  logger.debug("[ClaudeAdapter] extractDomArtifacts done", { count: artifacts.length });
  return artifacts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main adapter export
// ─────────────────────────────────────────────────────────────────────────────

export const claudeAdapter: ProviderAdapter = {
  id: "claude",
  match: (u) => u.hostname.endsWith("claude.ai"),
  isFullyExpandedView: (u) => u.pathname.startsWith("/share/"),

  getTitle(doc) {
    const headerTitle =
      doc.querySelector('[data-testid="chat-menu-trigger"]')?.textContent?.trim() ||
      doc.querySelector('[data-testid="page-header"] h1')?.textContent?.trim();
    if (headerTitle) return headerTitle;

    const firstHeading = doc.querySelector(".font-claude-response h1, .font-claude-response h2");
    if (firstHeading?.textContent?.trim()) return firstHeading.textContent.trim();

    return doc.title.replace(/\s*[-–|]\s*Claude.*$/i, "").trim() || "Untitled conversation";
  },

  async expandAll(doc, _signal?: AbortSignal) {
    logger.debug("[ClaudeAdapter] expandAll start");

    // Pass 1 — expand thinking, reasoning, show more by aria-label (safe, targeted)
    await expandUntilStable(doc, [
      'button[aria-label*="Thinking" i]',
      'button[aria-label*="Reasoning" i]',
      'button[aria-label*="Thought" i]',
      'button[aria-label*="Show" i]',
      'button[aria-label*="Expand" i]',
      'button[aria-label*="Continue" i]',
      'details summary',
    ]);

    // Scroll to bottom repeatedly to load all messages
    const scrollEl = doc.querySelector('[class*="chat-scroll"], [class*="conversation"], main') || doc.scrollingElement || doc.body;
    for (let i = 0; i < 8; i++) {
      try { scrollEl.scrollTop = scrollEl.scrollHeight; } catch {}
      await new Promise((r) => setTimeout(r, 400));
    }
    try { scrollEl.scrollTop = 0; } catch {}
    await new Promise((r) => setTimeout(r, 300));

    // Pass 2 — expand collapsed buttons only inside message elements (NOT artifact sidebar)
    for (const msgEl of doc.querySelectorAll<HTMLElement>('.font-claude-response, [data-testid="user-message"]')) {
      for (const btn of msgEl.querySelectorAll<HTMLElement>('button[aria-expanded="false"], [role="button"][aria-expanded="false"]')) {
        try { btn.click(); } catch {}
      }
    }

    // Pass 3 — expand code fold toggles (language labels) inside messages only
    for (const msgEl of doc.querySelectorAll<HTMLElement>('.font-claude-response, [data-testid="user-message"]')) {
      for (const btn of msgEl.querySelectorAll<HTMLElement>('button, [role="button"]')) {
        const t = (btn.textContent || "").trim().toLowerCase();
        if (t.length > 0 && t.length < 25 && /^[a-z][\w#+.]{0,20}$/.test(t) &&
            !/^(edit|copy|share|delete|remove|close|pin|mute|rename|archive|settings)$/i.test(t)) {
          try { btn.click(); } catch {}
        }
      }
    }

    doc.querySelectorAll("details:not([open])").forEach((d) => ((d as HTMLDetailsElement).open = true));
    await new Promise((r) => setTimeout(r, 2000));
    logger.debug("[ClaudeAdapter] expandAll done");
  },

  async extract(doc) {
    logger.debug("[ClaudeAdapter] extract start");
    const messages: Message[] = [];

    try {
      const userBlocks = Array.from(doc.querySelectorAll('[data-testid="user-message"]'));
      const assistantBlocks = Array.from(doc.querySelectorAll(".font-claude-response"));

      const all = [
        ...userBlocks.map((el) => ({ role: "user" as const, el })),
        ...assistantBlocks.map((el) => ({ role: "assistant" as const, el })),
      ].sort((a, b) => (a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1));

      logger.debug("[ClaudeAdapter] sorted blocks", { count: all.length });

      for (const { role, el } of all) {
        try {
          const parts = nodeToParts(el);
          if (parts.length) {
            messages.push({ role, parts, createdAt: readTimestamp(el) });
          }
        } catch (e: any) {
          logger.error("[ClaudeAdapter] failed to extract message", { role, error: e.message });
        }
      }

      // ── API enrichment: fetch full conversation detail for artifacts/tools ──
      let apiEnriched = false;
      try {
        const url = doc.location?.href || "";
        const orgId = getOrgIdFromPage(doc);
        const convId = extractConvIdFromUrl(url);
        const isShare = this.isFullyExpandedView?.(new URL(url));

        if (orgId && convId && !isShare) {
          logger.info("[ClaudeAdapter] fetching API detail for enrichment", { convId });
          const detail = await fetchClaudeDetail(orgId, convId);
          const { parts: apiParts, attachments: apiAttachments } = extractApiNonTextParts(detail);

          if (apiParts.length > 0) {
            const lastAssistant = messages.findLastIndex((m) => m.role === "assistant");
            if (lastAssistant >= 0) {
              messages[lastAssistant].parts.push(...apiParts);
            } else {
              messages.push({ role: "assistant", parts: apiParts });
            }
            apiEnriched = true;
            logger.info("[ClaudeAdapter] API enrichment appended", {
              apiParts: apiParts.length,
              apiAttachments: apiAttachments.length,
            });
          }

          if (apiAttachments.length > 0) {
            _cachedApiAttachments = apiAttachments;
          }
        }
      } catch (e: any) {
        logger.warn("[ClaudeAdapter] API enrichment failed, using DOM-only", { error: e.message });
      }

      // ── DOM artifact fallback (only if API enrichment didn't provide artifacts) ──
      if (!apiEnriched) {
        const domArtifacts = extractDomArtifacts(doc);
        if (domArtifacts.length > 0) {
          const lastAssistantIdx = messages.findLastIndex((m) => m.role === "assistant");
          if (lastAssistantIdx >= 0) {
            messages[lastAssistantIdx].parts.push(...domArtifacts);
          } else {
            messages.push({ role: "assistant", parts: domArtifacts });
          }
          logger.info("[ClaudeAdapter] appended DOM artifacts", { count: domArtifacts.length });
        }
      }

      logger.info("[ClaudeAdapter] extract done", {
        total: messages.length,
        user: messages.filter((m) => m.role === "user").length,
        assistant: messages.filter((m) => m.role === "assistant").length,
        apiEnriched,
      });

      return messages;
    } catch (e: any) {
      logger.error("[ClaudeAdapter] extract failed", { error: e.message });
      throw new Error(`Claude extraction failed: ${e.message}`);
    }
  },

  getOrgId(doc) {
    return getOrgIdFromPage(doc);
  },

  supportsBulk: true,

  async fetchList(authContext: string, limit: number, offset: number) {
    const orgId = authContext;
    if (!orgId) throw new Error("Organization ID required for Claude bulk");

    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations?limit=${limit}&offset=${offset}&consistency=eventual`;
    const response = await fetch(url, {
      credentials: "include",
      headers: { accept: "*/*" },
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      items: data.map((item: any) => ({
        id: item.uuid,
        title: item.name || "Untitled",
        url: `https://claude.ai/chat/${item.uuid}`,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
      nextOffset: data.length === limit ? offset + limit : undefined,
      total: data.length,
    };
  },

  async fetchDetail(authContext: string, conversationId: string) {
    const orgId = authContext;
    if (!orgId) throw new Error("Organization ID required for Claude bulk");
    return fetchClaudeDetail(orgId, conversationId);
  },

  // ───────────────────────────────────────────────────────────────────────────
  // parseBulkData — UPDATED
  //
  // What changed vs the previous version:
  //   • `document` content blocks are now parsed (user-uploaded text/PDF files).
  //     They are emitted as `attachment` Parts AND optionally saved to disk.
  //   • Artifact Parts are now emitted as proper `{ type: "artifact" }` Parts
  //     (previously they were pushed as raw markdown strings into contentParts[]).
  //   • Final artifact state (last version after all patches) is also emitted
  //     as `attachment` when saveAttachments is true.
  //   • `image` content blocks are parsed and emitted as attachment metadata.
  // ───────────────────────────────────────────────────────────────────────────
  async parseBulkData(data: any, options: any = {}) {
    const messages: Message[] = [];
    const attachments: Attachment[] = [];
    const warnings: string[] = [];

    // Track artifact state across create/update/rewrite commands
    const artifactMemory: Record<string, {
      current: string;
      title: string;
      type: string;
      version: number;
    }> = {};

    const chatMessages = data.chat_messages || [];

    for (const msg of chatMessages) {
      const role: "user" | "assistant" | "tool" =
        msg.sender === "human" ? "user" :
        msg.sender === "assistant" ? "assistant" :
        "tool";

      const parts: Part[] = [];

      for (const content of msg.content || []) {
        if (!content) continue;

        // ── Plain text ───────────────────────────────────────────────────────
        if (content.type === "text" && content.text) {
          parts.push({ type: "text", markdown: content.text });
          continue;
        }

        // ── Tool result (e.g. computer-use, web-search results) ─────────────
        if (content.type === "tool_result") {
          const result =
            typeof content.content === "string"
              ? content.content
              : content.content?.[0]?.text || content.text || "";
          if (result) parts.push({ type: "tool_result", name: "tool_result", output: result });
          continue;
        }

        // ── Tool use (artifacts + other tools) ──────────────────────────────
        if (content.type === "tool_use") {
          const toolName = content.name || "";
          const input = content.input || {};

          if (toolName === "artifacts") {
            // Reconstruct full artifact content through patch chain
            const artifactId =
              input.id || content.id || input.version_uuid ||
              `artifact-${attachments.length + 1}`;
            const command = (input.command || "create") as "create" | "rewrite" | "update";
            const mimeType = input.type || input.textdoc_type || "text/plain";
            const title = input.title || artifactId;

            let contentStr = "";
            const prev = artifactMemory[artifactId]?.current || "";

            if (command === "create" || command === "rewrite") {
              contentStr = typeof input.content === "string"
                ? input.content
                : JSON.stringify(input.content || input, null, 2);
            } else if (command === "update") {
              // Apply str_replace-style patch
              const oldStr = input.old_str || "";
              const newStr =
                input.new_str ||
                (typeof input.content === "string" ? input.content : "");
              if (prev.includes(oldStr)) {
                contentStr = prev.replace(oldStr, newStr);
              } else {
                contentStr = `${prev}\n\n/* patch_failed: old_str not found */\n${newStr}`;
                warnings.push(`Artifact patch failed for "${title}" — old_str not found`);
              }
            } else {
              contentStr = typeof input.content === "string"
                ? input.content
                : JSON.stringify(input.content || input, null, 2);
            }

            const version = (artifactMemory[artifactId]?.version || 0) + 1;
            artifactMemory[artifactId] = { current: contentStr, title, type: mimeType, version };

            // Emit as a proper artifact Part (serializer will render it with code block)
            parts.push({
              type: "artifact",
              title: `${title} (v${version})`,
              lang: getLanguageFromMime(mimeType),
              code: contentStr,
            });

            // Optionally save artifact file to disk
            if (options.saveAttachments) {
              const ext = getExtensionFromMime(mimeType);
              attachments.push({
                name: `${title}_v${version}.${ext}`,
                url: `data:${mimeType};base64,${btoa(unescape(encodeURIComponent(contentStr)))}`,
                mime: mimeType,
                data: contentStr,
              });
            }
            continue;
          }

          // Other tool calls — generic representation
          parts.push({
            type: "tool_use",
            name: toolName,
            input: input,
          });
          continue;
        }

        // ── User-uploaded document / file ────────────────────────────────────
        // Claude API returns user file uploads as:
        //   { type: "document", source: { type: "file" | "url", ... }, name?: string }
        // OR (older API versions):
        //   { type: "text", source: { type: "file", ... } }
        if (content.type === "document" || (content.type === "text" && content.source?.type === "file")) {
          const source = content.source || {};
          const fileName =
            content.name ||
            source.filename ||
            source.file_name ||
            `attachment-${attachments.length + 1}`;
          const mimeType = source.media_type || content.media_type || "application/octet-stream";

          // The extracted text (if Claude already processed it) may live in content.extracted_content
          const extractedText =
            content.extracted_content ||
            content.text ||
            (typeof source.data === "string" ? source.data : null);

          // Emit as attachment Part in the message
          parts.push({
            type: "attachment",
            name: fileName,
            mime: mimeType,
          });

          // Save the file when requested
          if (options.saveAttachments) {
            if (extractedText) {
              attachments.push({
                name: fileName,
                url: `data:${mimeType};base64,${btoa(unescape(encodeURIComponent(extractedText)))}`,
                mime: mimeType,
                data: extractedText,
              });
            } else if (source.url) {
              attachments.push({
                name: fileName,
                url: source.url,
                mime: mimeType,
              });
            }
          }
          continue;
        }

        // ── Image block (user-pasted or attached image) ──────────────────────
        if (content.type === "image") {
          const src =
            content.source?.url ||
            (content.source?.type === "base64"
              ? `data:${content.source.media_type};base64,${content.source.data}`
              : null);
          if (src) {
            parts.push({ type: "image", src, alt: content.alt || "" });
          }
          continue;
        }

        // ── Fallback — any other content with a text field ───────────────────
        if (content.text) {
          parts.push({ type: "text", markdown: content.text });
        }
      }

      if (parts.length === 0) {
        parts.push({ type: "text", markdown: " " });
      }

      messages.push({
        role,
        parts,
        createdAt: msg.created_at,
      });
    }

    // Also emit the final version of every artifact as a separate attachment file
    // (so the user gets the complete files, not just the diffs)
    if (options.saveAttachments) {
      for (const [, artifact] of Object.entries(artifactMemory)) {
        const ext = getExtensionFromMime(artifact.type);
        const alreadySaved = attachments.some((a) => a.name === `${artifact.title}_v${artifact.version}.${ext}`);
        if (!alreadySaved) {
          attachments.push({
            name: `${artifact.title}_final.${ext}`,
            url: `data:${artifact.type};base64,${btoa(unescape(encodeURIComponent(artifact.current)))}`,
            mime: artifact.type,
            data: artifact.current,
          });
        }
      }
    }

    return {
      title: data.name || "Claude conversation",
      url: `https://claude.ai/chat/${data.uuid}`,
      chatId: data.uuid,
      providerModel: data.model || undefined,
      messages,
      attachments,
      warnings,
    };
  },

  extractAttachments(doc) {
    const domAttachments = extractAttachmentsFromDocument(doc);
    if (_cachedApiAttachments && _cachedApiAttachments.length > 0) {
      const merged = [...domAttachments];
      const seen = new Set(merged.map((a) => a.url));
      for (const att of _cachedApiAttachments) {
        if (!seen.has(att.url)) {
          seen.add(att.url);
          merged.push(att);
        }
      }
      _cachedApiAttachments = null;
      return merged;
    }
    return domAttachments;
  },
};