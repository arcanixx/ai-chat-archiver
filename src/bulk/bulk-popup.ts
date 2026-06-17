import type { RuntimeMessage } from "../core/types";

document.addEventListener("DOMContentLoaded", () => {
  // Initialize i18n
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      const msg = chrome.i18n.getMessage(key);
      if (msg) el.textContent = msg;
    }
  });

  // DOM elements
  const formatSelect = document.getElementById("format-select") as HTMLSelectElement;
  const btnStartBulk = document.getElementById("btn-start-bulk") as HTMLButtonElement;
  const btnCancel = document.getElementById("btn-cancel") as HTMLButtonElement;
  const btnClose = document.getElementById("btn-close") as HTMLButtonElement;
  const btnBack = document.getElementById("btn-back") as HTMLButtonElement;
  const statusContainer = document.getElementById("status-container") as HTMLDivElement;
  const statusEmpty = document.getElementById("status-empty") as HTMLDivElement;
  const statusMessage = document.getElementById("status-message") as HTMLDivElement;
  const progressBar = document.getElementById("progress-bar") as HTMLDivElement;

  let currentExport: Promise<void> | null = null;
  let exportCancelled = false;

  // Show status message
  function showStatus(message: string, type: "info" | "success" | "error" = "info") {
    statusMessage.textContent = message;
    statusMessage.className = `status ${type}`;
    statusContainer.classList.remove("hidden");
    statusEmpty.classList.add("hidden");
  }

  // Hide status
  function hideStatus() {
    statusContainer.classList.add("hidden");
    statusEmpty.classList.remove("hidden");
  }

  // Update progress
  function updateProgress(percent: number) {
    progressBar.style.width = `${percent}%`;
  }

  // Start bulk export
  async function startBulkExport() {
    const format = formatSelect.value;
    
    if (currentExport) {
      showStatus("Export already in progress", "error");
      return;
    }

    exportCancelled = false;
    currentExport = (async () => {
      try {
        showStatus("Starting bulk export...", "info");
        updateProgress(0);

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]?.id) {
          throw new Error("No active tab found");
        }

        // Send bulk export message
        const response = await chrome.tabs.sendMessage(tabs[0].id, {
          kind: "bulk-export",
          format: format as "md" | "txt" | "pdf"
        } as RuntimeMessage);

        if (exportCancelled) {
          showStatus("Export cancelled", "info");
          return;
        }

        if (response?.success) {
          showStatus(`Export completed successfully!`, "success");
          updateProgress(100);
        } else {
          throw new Error(response?.error || "Export failed");
        }
      } catch (error) {
        if (exportCancelled) {
          showStatus("Export cancelled", "info");
        } else {
          showStatus(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`, "error");
        }
      } finally {
        currentExport = null;
        btnCancel.classList.add("hidden");
        btnClose.classList.remove("hidden");
      }
    })();

    // Update UI for in-progress state
    btnStartBulk.disabled = true;
    btnCancel.classList.remove("hidden");
    btnClose.classList.add("hidden");
  }

  // Cancel export
  function cancelExport() {
    exportCancelled = true;
    showStatus("Cancelling export...", "info");
    btnStartBulk.disabled = false;
    btnCancel.classList.add("hidden");
  }

  // Event listeners
  btnStartBulk.addEventListener("click", startBulkExport);
  btnCancel.addEventListener("click", cancelExport);
  
  btnClose.addEventListener("click", () => {
    window.close();
  });

  btnBack.addEventListener("click", () => {
    // Send message to main popup to show the main interface
    chrome.runtime.sendMessage({ kind: "show-main-popup" } as RuntimeMessage);
    window.close();
  });

  // Listen for messages from background/content scripts
  const onMessage = (message: RuntimeMessage) => {
    if (message.kind === "bulk-export-progress") {
      const data = message.data as { progress: number; message: string };
      showStatus(data.message, "info");
      updateProgress(data.progress);
    } else if (message.kind === "bulk-export-complete") {
      const data = message.data as { success: boolean; error?: string };
      if (data.success) {
        showStatus("Export completed successfully!", "success");
        updateProgress(100);
      } else {
        showStatus(`Export failed: ${data.error || 'Unknown error'}`, "error");
      }
      btnStartBulk.disabled = false;
      btnCancel.classList.add("hidden");
      btnClose.classList.remove("hidden");
      currentExport = null;
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  
  // Clean up listener when popup closes
  window.addEventListener("beforeunload", () => {
    chrome.runtime.onMessage.removeListener(onMessage);
  });
});