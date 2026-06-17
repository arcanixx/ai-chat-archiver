import type { RuntimeMessage } from "../core/types";
import { applyI18n } from "../core/i18n-helper";

function isSupportedChatUrl(url: string): boolean {
  const supportedHosts = [
    "claude.ai", "chatgpt.com", "chat.openai.com",
    "gemini.google.com", "chat.deepseek.com",
    "kimi.com", "www.kimi.com",
    "grok.com", "x.ai",
    "copilot.microsoft.com", "www.bing.com",
  ];
  try {
    const u = new URL(url);
    return supportedHosts.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
  } catch {
    return false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await applyI18n();

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentUrl = tabs[0]?.url || "";
  const isSupported = isSupportedChatUrl(currentUrl);

  if (!isSupported) {
    document.getElementById("btn-save")?.setAttribute("disabled", "true");
    document.getElementById("btn-selection")?.setAttribute("disabled", "true");
    (document.getElementById("btn-save") as HTMLButtonElement)!.style.opacity = "0.4";
    (document.getElementById("btn-selection") as HTMLButtonElement)!.style.opacity = "0.4";
    document.getElementById("btn-save")!.title = "Not available on this page";
    document.getElementById("btn-selection")!.title = "Not available on this page";
  }

  document.getElementById("btn-save")?.addEventListener("click", async () => {
    if (!isSupported) return;
    if (tabs[0]?.id) {
      try {
        await chrome.tabs.sendMessage(tabs[0].id, { kind: "extract-and-save", formats: ["md"] } as RuntimeMessage);
      } catch (err) {
        console.error("Failed to send save message:", err);
      }
      window.close();
    }
  });

  document.getElementById("btn-selection")?.addEventListener("click", async () => {
    if (!isSupported) return;
    if (tabs[0]?.id) {
      try {
        await chrome.tabs.sendMessage(tabs[0].id, { kind: "save-selection" } as RuntimeMessage);
      } catch (err) {
        console.error("Failed to send selection message:", err);
      }
      window.close();
    }
  });

  document.getElementById("btn-bulk")?.addEventListener("click", () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL("src/bulk/bulk-popup.html")
    });
    window.close();
  });

  document.getElementById("btn-options")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
});
