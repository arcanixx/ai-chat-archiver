import { logger } from "../core/logger";
import { getSettings } from "../core/settings";
import { serialize } from "../core/serializers";
import { buildFilename } from "../core/filename";
import { pushHistory } from "./history";
import type { Conversation, ExportFormat, RuntimeMessage } from "../core/types";

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
