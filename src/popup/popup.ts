import type { RuntimeMessage } from "../core/types";

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      const msg = chrome.i18n.getMessage(key);
      if (msg) el.textContent = msg;
    }
  });

  document.getElementById("btn-save")?.addEventListener("click", async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
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
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
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
