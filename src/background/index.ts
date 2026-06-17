import { logger } from "../core/logger";
import { getSettings } from "../core/settings";
import { serialize } from "../core/serializers";
import { buildFilename } from "../core/filename";
import { pushHistory } from "./history";
import { adapterFor } from "../adapters";
import { batchProcessor } from "../core/batch-processor";
import { attachmentToMarkdown, mergeAttachments } from "../core/attachments";
import type { Attachment, Conversation, ExportFormat, HistoryEntry, RuntimeMessage, ProviderId } from "../core/types";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function downloadOne(conv: Conversation, format: ExportFormat, settings: any) {
  const { text, mime, ext } = serialize(conv, format);
  const filename = buildFilename(settings.filenameTemplate, conv, ext, settings.folder);
  const blob = new Blob([text], { type: mime });
  const url = await blobToDataUrl(blob);
  
  await chrome.downloads.download({
    url,
    filename,
    conflictAction: "uniquify",
    saveAs: false,
  });
  return filename;
}

async function fetchAttachment(url: string): Promise<Blob> {
  if (url.startsWith("data:")) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch data attachment: ${response.status}`);
    return await response.blob();
  }

  const response = await fetch(url, {
    credentials: "include",
    headers: { accept: "*/*" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch attachment: ${response.status} ${response.statusText}`);
  }

  return await response.blob();
}

async function saveAttachment(blob: Blob, filename: string, folder: string): Promise<string> {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "") || "attachment";
  const fullPath = `${folder.replace(/\/+$/, "")}/${safeFilename}`;
  let url: string;
  try {
    url = URL.createObjectURL(blob);
  } catch {
    url = await blobToDataUrl(blob);
  }
  try {
    await chrome.downloads.download({
      url,
      filename: fullPath,
      conflictAction: "uniquify",
      saveAs: false,
    });
  } catch (err: any) {
    logger.error("Failed to save attachment", err);
    throw err;
  } finally {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }

  return fullPath;
}

async function saveConversationAttachments(conv: Conversation, settings: any): Promise<void> {
  if ((!settings.saveAttachments && !settings.downloadAttachments) || !conv.attachments?.length) return;
  const titleSlug = conv.title.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "conversation";
  const baseFolder = settings.folder || "AI-Chats";
  const folder = `${baseFolder}/${titleSlug}`;

  for (const att of conv.attachments) {
    try {
      let blob: Blob;
      if (att.data) {
        if (typeof att.data === "string" && att.data.startsWith("data:")) {
          blob = await fetchAttachment(att.data);
        } else {
          blob = new Blob([att.data], { type: att.mime || "text/plain" });
        }
      } else if (att.url) {
        blob = await fetchAttachment(att.url);
      } else {
        continue;
      }

      const savedPath = await saveAttachment(blob, att.name, folder);
      att.savedPath = savedPath;

      const lastMsg = conv.messages[conv.messages.length - 1];
      if (lastMsg?.parts.length) {
        const lastPart = lastMsg.parts[lastMsg.parts.length - 1];
        if (lastPart.type === "text") {
          lastPart.markdown += `\n\n${attachmentToMarkdown(att)}`;
        } else {
          lastMsg.parts.push({ type: "text", markdown: attachmentToMarkdown(att) });
        }
      }
    } catch (err: any) {
      logger.error(`Failed to save attachment ${att.name}`, err);
      conv.warnings.push(`Failed to save attachment: ${att.name} — ${err.message}${att.url ? ` (URL: ${att.url})` : ""}`);
    }
  }
}

async function extractConversationFromTab(tabId: number, provider: ProviderId): Promise<Conversation> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { kind: "extract-only" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.ok && response.conversation) {
        resolve(response.conversation);
      } else {
        reject(new Error(response?.error || "Extraction failed"));
      }
    });
  });
}

async function extractConversationFromUrl(url: string, provider: ProviderId): Promise<Conversation> {
  const tabs = await chrome.tabs.query({ url: `${url}*` });
  if (tabs[0]?.id) {
    return extractConversationFromTab(tabs[0].id, provider);
  }
  
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab.id) throw new Error("Failed to create tab");
  
  try {
    await new Promise<void>((resolve, reject) => {
      let loaded = false;
      const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (tabId === tab.id && changeInfo.status === "complete" && !loaded) {
          loaded = true;
          chrome.tabs.onUpdated.removeListener(listener);
          // Wait longer for SPA to hydrate and render
          setTimeout(resolve, 5000);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        if (!loaded) reject(new Error("Tab load timeout"));
      }, 45000);
    });
    return extractConversationFromTab(tab.id, provider);
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function historyFromConversation(conv: Conversation, formats: ExportFormat[], filename: string): HistoryEntry {
  return {
    id: Date.now().toString(),
    at: conv.capturedAt,
    provider: conv.provider,
    title: conv.title,
    url: conv.url,
    chatId: conv.chatId,
    filename,
    formats,
    warnings: conv.warnings.length,
    messageCount: conv.messages.length,
    attachmentCount: conv.attachments?.length || 0,
  };
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  if (msg.kind === "save-conversation") {
    (async () => {
      try {
        const settings = await getSettings();
        const conv = msg.conversation;
        conv.attachments = mergeAttachments(conv.attachments);
        let firstFilename = "";

        await saveConversationAttachments(conv, settings);

        for (const fmt of msg.formats) {
          const fn = await downloadOne(conv, fmt, settings);
          if (!firstFilename) firstFilename = fn;
        }
        
        await pushHistory(historyFromConversation(conv, msg.formats, firstFilename));
        
        logger.info("Saved conversation", {
          title: conv.title,
          provider: conv.provider,
          formats: msg.formats,
          attachmentCount: conv.attachments?.length || 0,
        });
        
        sendResponse({ ok: true });
      } catch (err: any) {
        logger.error("Save failed", err.message);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
  
  if (msg.kind === "save-selection") {
    (async () => {
      try {
        if (!msg.text) {
          sendResponse({ ok: false, error: "No text provided" });
          return;
        }
        const settings = await getSettings();
        const folder = settings.folder ? `${settings.folder}/snippets` : "snippets";
        const filename = `${folder}/${msg.filename || `snippet-${Date.now()}.md`}`;
        
        const blob = new Blob([msg.text], { type: "text/markdown" });
        const url = await blobToDataUrl(blob);
        
        await chrome.downloads.download({
          url,
          filename,
          conflictAction: "uniquify",
          saveAs: false,
        });
        
        logger.info("Saved selection", { filename });
        sendResponse({ ok: true });
      } catch (err: any) {
        logger.error("Save selection failed", err.message);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.kind === "batch-extract") {
    (async () => {
      try {
        const adapter = adapterFor(msg.url);
        if (!adapter) {
          sendResponse({ ok: false, error: `No adapter for URL: ${msg.url}` });
          return;
        }
        const conversation = await extractConversationFromUrl(msg.url, msg.provider);
        sendResponse({ ok: true, conversation });
      } catch (err: any) {
        logger.error("Batch extract failed", { url: msg.url, error: err.message });
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.kind === "batch-start") {
    (async () => {
      try {
        batchResults = [];
        batchFormats = msg.formats;
        batchProcessor.setMaxConcurrent(msg.concurrency);

        let addedCount = 0;
        for (const url of msg.urls) {
          const adapter = adapterFor(url);
          if (adapter) {
            batchProcessor.addJob(url, adapter.id as ProviderId);
            addedCount++;
          } else {
            logger.warn("No adapter for URL in batch", { url });
          }
        }

        if (addedCount === 0) {
          sendResponse({ ok: false, error: "No valid URLs with supported providers" });
          return;
        }

        batchProcessor.processQueue();
        logger.info("Batch started", { count: addedCount, concurrency: msg.concurrency });
        sendResponse({ ok: true });
      } catch (err: any) {
        logger.error("Batch start failed", { error: err.message });
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.kind === "batch-pause") {
    batchProcessor.pause();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.kind === "batch-resume") {
    batchProcessor.resume();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.kind === "batch-cancel") {
    batchProcessor.cancel();
    batchResults = [];
    sendResponse({ ok: true });
    return true;
  }

  if (msg.kind === "batch-status") {
    const progress = batchProcessor.getProgress();
    const done = progress.total > 0 && (progress.completed + progress.failed) >= progress.total;
    sendResponse({ progress, results: batchResults, done });
    return true;
  }
});

let batchResults: Array<{ id: string; url: string; status: string; error?: string; messageCount?: number; attachmentCount?: number; }> = [];
let batchFormats: ExportFormat[] = ["md"];

batchProcessor.onJobUpdate((job) => {
  if (job.status === "completed" && job.result) {
    (async () => {
      try {
        const settings = await getSettings();
        const conv = job.result!;
        conv.attachments = mergeAttachments(conv.attachments);
        await saveConversationAttachments(conv, settings);
        let firstFilename = "";
        for (const fmt of batchFormats) {
          const fn = await downloadOne(conv, fmt, settings);
          if (!firstFilename) firstFilename = fn;
        }
        await pushHistory(historyFromConversation(conv, batchFormats, firstFilename));
      } catch (err: any) {
        logger.error("Batch download failed", { id: job.id, error: err.message });
      }
    })();

    batchResults.push({
      id: job.id,
      url: job.url,
      status: "completed",
      messageCount: job.result.messages.length,
      attachmentCount: job.result.attachments?.length || 0,
    });
  } else if (job.status === "failed") {
    batchResults.push({
      id: job.id,
      url: job.url,
      status: "failed",
      error: job.error,
    });
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  // Check if keyboard shortcuts are assigned; if not, log a warning
  const commands = await chrome.commands.getAll();
  for (const cmd of commands) {
    if (cmd.name && cmd.shortcut === "") {
      logger.warn(`Shortcut "${cmd.name}" not assigned — tell user to set it at chrome://extensions/shortcuts`);
    }
  }
  // Set default settings if not present
  const existing = await chrome.storage.sync.get("language");
  if (!existing.language) {
    await chrome.storage.sync.set({ language: "en" });
  }
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === "save-now") {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { kind: "extract-and-save", formats: ["md"] });
    }
  } else if (cmd === "save-selection") {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { kind: "save-selection" });
    }
  } else if (cmd === "open-batch") {
    const url = chrome.runtime.getURL("src/bulk/bulk-popup.html");
    chrome.tabs.create({ url });
  }
});
