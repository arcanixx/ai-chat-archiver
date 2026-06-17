import { logger } from "../core/logger";
import { getSettings } from "../core/settings";
import { serialize } from "../core/serializers";
import { buildFilename } from "../core/filename";
import { pushHistory } from "./history";
import { adapterFor } from "../adapters";
import { batchProcessor } from "../core/batch-processor";
import type { Conversation, ExportFormat, RuntimeMessage, ProviderId } from "../core/types";

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
  
  // Create a new tab if needed
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab.id) throw new Error("Failed to create tab");
  
  try {
    await new Promise<void>((resolve, reject) => {
      const listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (tabId === tab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 2000);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => reject(new Error("Tab load timeout")), 30000);
    });
    return extractConversationFromTab(tab.id, provider);
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  if (msg.kind === "save-conversation") {
    (async () => {
      try {
        const settings = await getSettings();
        let firstFilename = "";
        
        for (const fmt of msg.formats) {
          const fn = await downloadOne(msg.conversation, fmt, settings);
          if (!firstFilename) firstFilename = fn;
        }
        
        await pushHistory({
          id: Date.now().toString(),
          at: msg.conversation.capturedAt,
          provider: msg.conversation.provider,
          title: msg.conversation.title,
          url: msg.conversation.url,
          chatId: msg.conversation.chatId,
          filename: firstFilename,
          formats: msg.formats,
          warnings: msg.conversation.warnings.length,
          messageCount: msg.conversation.messages.length,
        });
        
        logger.info("Saved conversation", {
          title: msg.conversation.title,
          provider: msg.conversation.provider,
          formats: msg.formats,
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

  // ── Batch lifecycle ──────────────────────────────────────────────────────

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

// ── Batch result tracking ─────────────────────────────────────────────────
let batchResults: Array<{ id: string; url: string; status: string; error?: string; messageCount?: number; }> = [];
let batchFormats: ExportFormat[] = ["md"];

batchProcessor.onJobUpdate((job) => {
  if (job.status === "completed" && job.result) {
    // Download the completed conversation
    (async () => {
      try {
        const settings = await getSettings();
        for (const fmt of batchFormats) {
          await downloadOne(job.result!, fmt, settings);
        }
        await pushHistory({
          id: Date.now().toString(),
          at: job.result!.capturedAt,
          provider: job.result!.provider,
          title: job.result!.title,
          url: job.result!.url,
          chatId: job.result!.chatId,
          filename: "",
          formats: batchFormats,
          warnings: job.result!.warnings.length,
          messageCount: job.result!.messages.length,
        });
      } catch (err: any) {
        logger.error("Batch download failed", { id: job.id, error: err.message });
      }
    })();

    batchResults.push({
      id: job.id,
      url: job.url,
      status: "completed",
      messageCount: job.result.messages.length,
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
    chrome.runtime.openOptionsPage();
  }
});
