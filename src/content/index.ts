import { adapterFor } from "../adapters";
import { toast, injectFloatingButton } from "./ui";
import { repairFences } from "../core/fence";
import { logger } from "../core/logger";
import type { Conversation, ExportFormat, RuntimeMessage } from "../core/types";

export { buildConversation, handleSaveConversation, saveSelection };

const STORAGE_KEY = "ai_archiver_tracked_chats";
const FLOAT_BTN_ID = "ai-archiver-float-btn";

function extractChatId(url: string, provider: string): string | undefined {
  const u = new URL(url);
  switch (provider) {
    case "claude":   return u.pathname.match(/\/(chat|share)\/([a-z0-9-]+)/i)?.[2];
    case "chatgpt":  return u.pathname.match(/\/(c|chat)\/([a-z0-9-]+)/i)?.[2];
    case "gemini":   return u.pathname.match(/\/(app|share)\/([a-z0-9]+)/i)?.[2];
    case "deepseek": return u.pathname.match(/\/(chat|share)\/([a-z0-9]+)/i)?.[2];
    case "kimi":     return u.pathname.match(/\/(chat|share)\/([a-z0-9-]+)/i)?.[2];
    case "grok":     return u.pathname.match(/\/(chat|g)\/([a-z0-9-]+)/i)?.[2] || u.searchParams.get("id") || undefined;
    case "copilot":  return u.searchParams.get("convid") || u.pathname.match(/\/(chat|web)\/([a-z0-9-]+)/i)?.[2];
    default:         return undefined;
  }
}

function detectAttachments(doc: Document) {
  const attachments: Array<{ name: string; url: string; mime?: string }> = [];
  doc.querySelectorAll('img[src*="attachment"], img[src*="upload"], img[data-type="attachment"]').forEach((img) => {
    const src = (img as HTMLImageElement).src;
    if (src && !src.startsWith("data:")) {
      attachments.push({ name: img.getAttribute("alt") || "attachment", url: src, mime: "image/*" });
    }
  });
  doc.querySelectorAll('a[href*="file"], a[download], [data-testid*="attachment"]').forEach((a) => {
    const href = (a as HTMLAnchorElement).href;
    const name = a.textContent?.trim() || a.getAttribute("download") || "file";
    if (href && !attachments.find((att) => att.url === href)) {
      attachments.push({ name, url: href });
    }
  });
  return attachments;
}

async function buildConversation(): Promise<Conversation> {
  const startTime = Date.now();
  const adapter = adapterFor(location.href);
  if (!adapter) {
    logger.error("No adapter for this site", { url: location.href });
    throw new Error("No adapter for this site");
  }

  logger.debug("Starting conversation build", { provider: adapter.id, url: location.href });

  const conv: Conversation = {
    schemaVersion: 1,
    provider: adapter.id as any,
    title: "",
    url: location.href,
    capturedAt: new Date().toISOString(),
    messages: [],
    warnings: [],
  };

  try {
    conv.title = adapter.getTitle(document);
    logger.debug("Extracted title", { title: conv.title });
  } catch (e: any) {
    logger.error("Failed to extract title", { error: e.message });
    conv.title = "Untitled conversation";
    conv.warnings.push(`Failed to extract title: ${e.message}`);
  }

  try {
    conv.providerModel = adapter.detectModel?.(document);
    logger.debug("Detected model", { model: conv.providerModel });
  } catch (e: any) {
    logger.warn("Failed to detect model", { error: e.message });
  }

  try {
    conv.chatId = extractChatId(location.href, adapter.id);
    logger.debug("Extracted chat ID", { chatId: conv.chatId });
  } catch (e: any) {
    logger.warn("Failed to extract chat ID", { error: e.message });
  }

  try {
    conv.attachments = detectAttachments(document);
    logger.debug("Detected attachments", { count: conv.attachments.length });
  } catch (e: any) {
    logger.error("Failed to detect attachments", { error: e.message });
    conv.warnings.push(`Failed to detect attachments: ${e.message}`);
  }

  const skipExpand = adapter.isFullyExpandedView?.(new URL(location.href)) ?? false;
  if (!skipExpand) {
    try {
      await adapter.expandAll(document);
      logger.debug("Expanded all sections");
    } catch (e: any) {
      logger.error("expandAll failed", { error: e.message });
      conv.warnings.push(`expandAll failed: ${e.message}`);
    }
  }

  try {
    conv.messages = await adapter.extract(document);
    logger.debug("Extracted messages", { count: conv.messages.length });
  } catch (e: any) {
    logger.error("Failed to extract messages", { error: e.message });
    throw new Error(`Failed to extract messages: ${e.message}`);
  }

  try {
    const postAttachments = detectAttachments(document);
    if (postAttachments.length > (conv.attachments?.length || 0)) {
      conv.attachments = postAttachments;
      logger.debug("Updated attachments", { count: conv.attachments.length });
    }
  } catch (e: any) {
    logger.error("Failed to update attachments", { error: e.message });
  }

  try {
    let fenceFixes = 0;
    for (const m of conv.messages) {
      for (const p of m.parts) {
        if (p.type === "text") {
          const r = repairFences(p.markdown);
          if (r.fixed) { 
            p.markdown = r.text; 
            fenceFixes++; 
          }
        }
      }
    }
    if (fenceFixes) {
      conv.warnings.push(`${fenceFixes} message(s) had unterminated code fences.`);
      logger.debug("Fixed code fences", { count: fenceFixes });
    }
  } catch (e: any) {
    logger.error("Failed to repair fences", { error: e.message });
    conv.warnings.push(`Failed to repair code fences: ${e.message}`);
  }

  try {
    const missingArtifacts = conv.messages.reduce(
      (n, m) => n + m.parts.filter((p) => p.type === "artifact" && !p.code).length, 0
    );
    if (missingArtifacts) {
      conv.warnings.push(`${missingArtifacts} artifact(s) captured by title only.`);
      logger.debug("Missing artifacts detected", { count: missingArtifacts });
    }
  } catch (e: any) {
    logger.error("Failed to count missing artifacts", { error: e.message });
  }

  if (!conv.messages.length) {
    const errorMsg = "No messages extracted — DOM may have changed.";
    conv.warnings.push(errorMsg);
    logger.error(errorMsg);
  }

  const duration = Date.now() - startTime;
  logger.info("Conversation build completed", { 
    provider: adapter.id, 
    messageCount: conv.messages.length,
    warningCount: conv.warnings.length,
    durationMs: duration 
  });

  return conv;
}

function detectLangFromText(text: string): string | undefined {
  if (text.includes("import ") && text.includes("from ")) return "typescript";
  if (text.includes("function") || text.includes("const "))  return "javascript";
  if (text.includes("<html") || text.includes("<div"))       return "html";
  if (text.includes("SELECT ") || text.includes("FROM "))    return "sql";
  if (text.includes("def ") || text.includes("import "))     return "python";
  if (text.includes("{ ") && text.includes("}"))             return "json";
  return undefined;
}

async function saveSelection() {
  const startTime = Date.now();
  logger.debug("Starting save selection");

  try {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.toString().trim().length < 3) {
      logger.warn("No valid text selection");
      toast("Select some text first!", "err");
      return;
    }

    const text = selection.toString();
    const looksLikeCode =
      /^[ \t]+/.test(text) || /[{};]/.test(text) ||
      text.includes("function") || text.includes("const ");
    const lang = looksLikeCode ? detectLangFromText(text) : undefined;

    logger.debug("Selection detected", { 
      length: text.length, 
      looksLikeCode, 
      lang 
    });

    // Auto-generate filename instead of prompting (prompt can be blocked)
    const filename = `snippet-${Date.now()}`;

    logger.debug("Filename determined", { filename });

    // Build a proper Markdown document
    const sourceUrl = location.href;
    const capturedAt = new Date().toLocaleString();
    let snippet: string;
    if (lang) {
      snippet =
        `# Code Snippet\n\n` +
        `> Source: ${sourceUrl}  \n> Captured: ${capturedAt}\n\n` +
        `\`\`\`${lang}\n${text}\n\`\`\``;
    } else {
      snippet =
        `# Text Snippet\n\n` +
        `> Source: ${sourceUrl}  \n> Captured: ${capturedAt}\n\n` +
        `${text}`;
    }

    logger.debug("Snippet built", { length: snippet.length });

    // Send to background once — background does the download
    try {
      await sendRuntimeMessage({
        kind: "save-selection",
        text: snippet,
        filename: `${filename}.md`,
      } as RuntimeMessage);

      const duration = Date.now() - startTime;
      logger.info("Selection save initiated", { 
        filename: `${filename}.md`,
        textLength: text.length,
        durationMs: duration 
      });

      toast(`Saved snippet (${text.length} chars)`);
    } catch (e: any) {
      logger.error("Failed to send selection to background", { error: e.message });
      throw new Error(`Failed to save selection: ${e.message}`);
    }
  } catch (err: any) {
    logger.error("Save selection failed", { 
      url: location.href,
      error: err.message,
      stack: err.stack 
    });
    toast(`Error: ${err.message}`, "err");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Send a message to the background script, with context-invalidation handling. */
function sendRuntimeMessage(msg: RuntimeMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || "Unknown error";
          if (errMsg.includes("context invalidated") || errMsg.includes("Receiving end does not exist")) {
            reject(new Error("Extension context invalidated — please reload this page"));
          } else {
            reject(new Error(errMsg));
          }
        } else {
          resolve(response);
        }
      });
    } catch (e: any) {
      if (e.message?.includes("context invalidated")) {
        reject(new Error("Extension context invalidated — please reload this page"));
      } else {
        reject(e);
      }
    }
  });
}

// ─── Save conversation ─────────────────────────────────────────────────────────

async function handleSaveConversation() {
  const startTime = Date.now();
  logger.debug("Starting save conversation", { url: location.href });

  try {
    const conversation = await buildConversation();
    logger.info("Conversation built successfully", { 
      provider: conversation.provider,
      messageCount: conversation.messages.length,
      warningCount: conversation.warnings.length 
    });

    const settings = await chrome.storage.sync.get({
      enabledFormats: ["md"],
    });
    const formats: ExportFormat[] = (settings.enabledFormats as ExportFormat[]).length
      ? (settings.enabledFormats as ExportFormat[])
      : ["md"];

    logger.debug("Save settings", { formats });

    // ── Deduplication by chatId + messageCount ──────────────────────────────
    if (conversation.chatId) {
      try {
        const stored = await chrome.storage.local.get("ai_archiver_history_v1");
        const history: any[] = stored["ai_archiver_history_v1"] || [];

        const existing = history.find(
          (h) =>
            h.chatId === conversation.chatId &&
            h.messageCount === conversation.messages.length
        );
        if (existing) {
          logger.info("Conversation already saved - deduplication", { 
            chatId: conversation.chatId,
            title: conversation.title 
          });
          toast("Archive is already up to date");
          return;
        }
        logger.debug("Deduplication check passed", { chatId: conversation.chatId });
      } catch (e: any) {
        logger.warn("Deduplication check failed", { error: e.message });
        // Continue with save even if deduplication fails
      }
    }
    // ───────────────────────────────────────────────────────────────────────

    try {
      await sendRuntimeMessage({
        kind: "save-conversation",
        conversation,
        formats,
      } as RuntimeMessage);

      const duration = Date.now() - startTime;
      logger.info("Conversation save initiated", { 
        provider: conversation.provider,
        formats,
        durationMs: duration 
      });

      toast(
        `Saved ${conversation.messages.length} msgs` +
        (conversation.warnings.length ? `, ${conversation.warnings.length} ⚠` : "")
      );
    } catch (e: any) {
      logger.error("Failed to send save message to background", { error: e.message });
      throw new Error(`Failed to save: ${e.message}`);
    }
  } catch (err: any) {
    logger.error("Save conversation failed", { 
      url: location.href,
      error: err.message,
      stack: err.stack 
    });
    toast(`Error: ${err.message}`, "err");
  }
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  (async () => {
    try {
      logger.debug("Received runtime message", { kind: msg.kind });
      
      if (msg.kind === "extract-only") {
        logger.debug("Processing extract-only request");
        const conversation = await buildConversation();
        sendResponse({ ok: true, conversation });
      } else if (msg.kind === "extract-and-save") {
        logger.debug("Processing extract-and-save request");
        await handleSaveConversation();
        sendResponse({ ok: true });
      } else if (msg.kind === "save-selection") {
        logger.debug("Processing save-selection command from background");
        await saveSelection();
        sendResponse({ ok: true });
      } else {
        logger.warn("Unknown message kind", { kind: msg.kind });
        sendResponse({ ok: false, error: "Unknown message kind" });
      }
    } catch (e: any) {
      logger.error("Failed to handle runtime message", { 
        kind: msg.kind, 
        error: e.message,
        stack: e.stack 
      });
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});



// ─── Inject floating button ───────────────────────────────────────────────────

async function maybeInject() {
  try {
    const adapter = adapterFor(location.href);
    if (!adapter) {
      logger.debug("No adapter for current URL, removing floating button", { url: location.href });
      document.getElementById(FLOAT_BTN_ID)?.remove();
      return;
    }

    logger.debug("Adapter found for current URL", { provider: adapter.id, url: location.href });

    try {
      const { showFloatingButton = true, perProvider = {} } = await chrome.storage.sync.get([
        "showFloatingButton",
        "perProvider",
      ]);
      
      if (showFloatingButton === false) {
        logger.debug("Floating button disabled globally");
        return;
      }
      
      if (perProvider && perProvider[adapter.id as any] === false) {
        logger.debug("Floating button disabled for this provider", { provider: adapter.id });
        return;
      }

      logger.debug("Injecting floating button", { provider: adapter.id });
      injectFloatingButton(handleSaveConversation, saveSelection);
    } catch (e: any) {
      logger.error("Failed to get settings for floating button", { error: e.message });
      // Fallback to default behavior
      injectFloatingButton(handleSaveConversation, saveSelection);
    }
  } catch (e: any) {
    logger.error("Failed to inject floating button", { error: e.message });
  }
}

try {
  const origPush = history.pushState;
  history.pushState = function (...args) {
    try {
      const r = origPush.apply(this, args);
      logger.debug("History pushState called, scheduling injection");
      setTimeout(maybeInject, 800);
      return r;
    } catch (e: any) {
      logger.error("Error in history pushState override", { error: e.message });
      return origPush.apply(this, args);
    }
  };
  
  window.addEventListener("popstate", () => {
    logger.debug("Popstate event, scheduling injection");
    setTimeout(maybeInject, 800);
  });
  
  logger.debug("History override installed");
} catch (e: any) {
  logger.error("Failed to install history override", { error: e.message });
}

try {
  logger.debug("Initial injection attempt");
  maybeInject();
} catch (e: any) {
  logger.error("Failed to inject floating button initially", { error: e.message });
}
