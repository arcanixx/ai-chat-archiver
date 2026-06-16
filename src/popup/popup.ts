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
      chrome.tabs.sendMessage(tabs[0].id, { kind: "extract-and-save", formats: ["md"] } as RuntimeMessage);
      window.close();
    }
  });

  document.getElementById("btn-selection")?.addEventListener("click", async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { kind: "save-selection" } as RuntimeMessage);
      window.close();
    }
  });

  document.getElementById("btn-options")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
});
