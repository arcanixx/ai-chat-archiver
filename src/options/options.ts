import { getSettings, saveSettings } from "../core/settings";
import { applyI18n } from "../core/i18n-helper";
import type { ExportFormat, ProviderId } from "../core/types";

document.addEventListener("DOMContentLoaded", async () => {
  await applyI18n();

  const folderEl = document.getElementById("folder") as HTMLInputElement;
  const templateEl = document.getElementById("filenameTemplate") as HTMLInputElement;
  const btnEl = document.getElementById("showFloatingButton") as HTMLInputElement;
  const titlePrefixEl = document.getElementById("titlePrefixIgnore") as HTMLInputElement;
  const languageEl = document.getElementById("language") as HTMLSelectElement;
  const fmtJsonEl = document.getElementById("fmt-json") as HTMLInputElement;
  const fmtMdEl = document.getElementById("fmt-md") as HTMLInputElement;
  const fmtHtmlEl = document.getElementById("fmt-html") as HTMLInputElement;
  const fmtPdfEl = document.getElementById("fmt-pdf") as HTMLInputElement;
  const provClaudeEl = document.getElementById("prov-claude") as HTMLInputElement;
  const provChatgptEl = document.getElementById("prov-chatgpt") as HTMLInputElement;
  const provGeminiEl = document.getElementById("prov-gemini") as HTMLInputElement;
  const provDeepseekEl = document.getElementById("prov-deepseek") as HTMLInputElement;
  const provKimiEl = document.getElementById("prov-kimi") as HTMLInputElement;
  const provGrokEl = document.getElementById("prov-grok") as HTMLInputElement;
  const provCopilotEl = document.getElementById("prov-copilot") as HTMLInputElement;
  
  // Bulk export settings
  const bulkSaveAttachmentsEl = document.getElementById("bulkSaveAttachments") as HTMLInputElement;
  const bulkDownloadAttachmentsEl = document.getElementById("bulkDownloadAttachments") as HTMLInputElement;
  const bulkDefaultFormatEl = document.getElementById("bulkDefaultFormat") as HTMLSelectElement;

  const batchUrlsEl = document.getElementById("batchUrls") as HTMLTextAreaElement;
  const batchConcurrencyEl = document.getElementById("batchConcurrency") as HTMLInputElement;
  const batchValidateBtn = document.getElementById("batchValidate") as HTMLButtonElement;
  const batchStartBtn = document.getElementById("batchStart") as HTMLButtonElement;
  const batchPauseBtn = document.getElementById("batchPause") as HTMLButtonElement;
  const batchResumeBtn = document.getElementById("batchResume") as HTMLButtonElement;
  const batchCancelBtn = document.getElementById("batchCancel") as HTMLButtonElement;
  const batchProgressEl = document.getElementById("batchProgress") as HTMLDivElement;
  const progressFillEl = document.getElementById("progressFill") as HTMLDivElement;
  const progressCurrentEl = document.getElementById("progressCurrent") as HTMLSpanElement;
  const progressEtaEl = document.getElementById("progressEta") as HTMLSpanElement;
  const batchResultsEl = document.getElementById("batchResults") as HTMLDivElement;
  const validationErrorEl = document.getElementById("batchValidationError") as HTMLDivElement;

  const settings = await getSettings();
  folderEl.value = settings.folder;
  templateEl.value = settings.filenameTemplate;
  btnEl.checked = settings.showFloatingButton;
  titlePrefixEl.value = settings.titlePrefixIgnore ?? "";
  languageEl.value = settings.language ?? "en";
  batchConcurrencyEl.value = String(settings.batchConcurrency ?? 2);

  fmtJsonEl.checked = settings.enabledFormats.includes("json");
  fmtMdEl.checked = settings.enabledFormats.includes("md");
  fmtHtmlEl.checked = settings.enabledFormats.includes("html");
  fmtPdfEl.checked = settings.enabledFormats.includes("pdf");
  
  // Bulk export settings
  bulkSaveAttachmentsEl.checked = settings.saveAttachments ?? true;
  bulkDownloadAttachmentsEl.checked = settings.downloadAttachments ?? false;
  bulkDefaultFormatEl.value = settings.bulkDefaultFormat || "md";

  provClaudeEl.checked = settings.perProvider?.claude ?? true;
  provChatgptEl.checked = settings.perProvider?.chatgpt ?? true;
  provGeminiEl.checked = settings.perProvider?.gemini ?? true;
  provDeepseekEl.checked = settings.perProvider?.deepseek ?? true;
  provKimiEl.checked = settings.perProvider?.kimi ?? true;
  provGrokEl.checked = settings.perProvider?.grok ?? true;
  provCopilotEl.checked = settings.perProvider?.copilot ?? true;

  let abortController: AbortController | null = null;
  let currentBatchId = 0;
  let renderedJobIds = new Set<string>();

  function showValidationError(msg: string) {
    validationErrorEl.textContent = msg;
    validationErrorEl.classList.add("show");
  }
  function clearValidationError() {
    validationErrorEl.classList.remove("show");
  }

  function parseUrls(text: string): string[] {
    return text.split("\n").map(s => s.trim()).filter(s => s.length > 0);
  }

  function validateUrl(url: string): { valid: boolean; provider?: ProviderId; error?: string } {
    try {
      const u = new URL(url);
      const providers: Record<string, ProviderId> = {
        "claude.ai": "claude",
        "chatgpt.com": "chatgpt",
        "chat.openai.com": "chatgpt",
        "gemini.google.com": "gemini",
        "kimi.com": "kimi",
        "www.kimi.com": "kimi",
        "chat.deepseek.com": "deepseek",
        "grok.com": "grok",
        "x.ai": "grok",
        "copilot.microsoft.com": "copilot",
        "www.bing.com": "copilot",
      };
      for (const [host, provider] of Object.entries(providers)) {
        if (u.hostname === host || u.hostname.endsWith("." + host)) {
          return { valid: true, provider };
        }
      }
      return { valid: false, error: `Nieobsługiwany provider: ${u.hostname}` };
    } catch {
      return { valid: false, error: "Nieprawidłowy URL" };
    }
  }

  batchValidateBtn.addEventListener("click", () => {
    clearValidationError();
    const urls = parseUrls(batchUrlsEl.value);
    if (urls.length === 0) {
      showValidationError("Wklej co najmniej jeden URL");
      return;
    }
    const invalid = urls.map(u => validateUrl(u)).filter(r => !r.valid);
    if (invalid.length > 0) {
      showValidationError(`Nieprawidłowe URL (${invalid.length}): ${invalid.map(i => i.error).join(", ")}`);
      return;
    }
    showValidationError(""); // clear
    validationErrorEl.textContent = `OK: ${urls.length} poprawnych URL`;
    validationErrorEl.style.color = "#059669";
    validationErrorEl.classList.add("show");
    setTimeout(() => validationErrorEl.classList.remove("show"), 3000);
  });

  function renderProgress(progress: {
    total: number; completed: number; failed: number; running: number; pending: number;
    currentUrl?: string; estimatedTimeRemaining?: number;
  }) {
    const done = progress.completed + progress.failed;
    const pct = progress.total ? Math.round((done / progress.total) * 100) : 0;
    progressFillEl.style.width = `${pct}%`;
    progressCurrentEl.textContent = `${done} / ${progress.total}`;
    if (progress.estimatedTimeRemaining && progress.estimatedTimeRemaining > 0) {
      const eta = Math.round(progress.estimatedTimeRemaining / 1000);
      const m = Math.floor(eta / 60);
      const s = eta % 60;
      progressEtaEl.textContent = m > 0 ? `~${m}m ${s}s` : `~${s}s`;
    } else {
      progressEtaEl.textContent = "";
    }
  }

  function addResultItem(job: {
    id: string; url: string; status: string; error?: string; messageCount?: number;
  }) {
    const div = document.createElement("div");
    div.className = `batch-result-item ${job.status === "completed" ? "success" : "error"}`;
    const urlSpan = document.createElement("span");
    urlSpan.className = "url";
    urlSpan.title = job.url;
    urlSpan.textContent = job.url;
    const statusDot = document.createElement("span");
    statusDot.className = "status-dot";
    const msgSpan = document.createElement("span");
    msgSpan.className = "msg-count";
    msgSpan.textContent = job.messageCount ? `${job.messageCount} msgs` : "";
    div.appendChild(statusDot);
    div.appendChild(urlSpan);
    div.appendChild(msgSpan);
    if (job.error) {
      const errSpan = document.createElement("span");
      errSpan.className = "msg-count";
      errSpan.style.color = "#dc2626";
      errSpan.textContent = job.error;
      div.appendChild(errSpan);
    }
    batchResultsEl.insertBefore(div, batchResultsEl.firstChild);
  }

  function setBatchButtons(state: "idle" | "running" | "paused") {
    batchStartBtn.disabled = state !== "idle";
    batchPauseBtn.disabled = state !== "running";
    batchResumeBtn.disabled = state !== "paused";
    batchCancelBtn.disabled = state === "idle";
    batchValidateBtn.disabled = state !== "idle";
    batchUrlsEl.disabled = state !== "idle";
    batchConcurrencyEl.disabled = state !== "idle";
    batchProgressEl.style.display = state === "idle" ? "none" : "block";
  }

  batchStartBtn.addEventListener("click", async () => {
    clearValidationError();
    const urls = parseUrls(batchUrlsEl.value);
    if (urls.length === 0) {
      showValidationError("Brak URL do przetworzenia");
      return;
    }
    const invalid = urls.map(u => validateUrl(u)).filter(r => !r.valid);
    if (invalid.length > 0) {
      showValidationError(`Nieprawidłowe URL: ${invalid.map(i => i.error).join(", ")}`);
      return;
    }

    const concurrency = Math.max(1, Math.min(5, parseInt(batchConcurrencyEl.value) || 2));
    const formats: ExportFormat[] = [];
    if (fmtMdEl.checked) formats.push("md");
    if (fmtJsonEl.checked) formats.push("json");
    if (fmtHtmlEl.checked) formats.push("html");
    if (formats.length === 0) formats.push("md");

    batchResultsEl.innerHTML = "";
    renderedJobIds = new Set();
    setBatchButtons("running");
    abortController = new AbortController();
    currentBatchId++;

    try {
      const response = await chrome.runtime.sendMessage({
        kind: "batch-start",
        urls,
        formats,
        concurrency,
      } as any);

      if (!response.ok) {
        throw new Error(response.error || "Batch start failed");
      }
    } catch (e: any) {
      setBatchButtons("idle");
      showValidationError(e.message);
      return;
    }

    const pollInterval = setInterval(async () => {
      if (!abortController || abortController.signal.aborted) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const resp = await chrome.runtime.sendMessage({ kind: "batch-status" } as any);
        if (resp?.progress) {
          renderProgress(resp.progress);
        }
        if (resp?.results) {
          for (const job of resp.results) {
            if (!renderedJobIds.has(job.id)) {
              renderedJobIds.add(job.id);
              addResultItem(job);
            }
          }
        }
        if (resp?.done) {
          clearInterval(pollInterval);
          setBatchButtons("idle");
        }
      } catch {
        clearInterval(pollInterval);
        setBatchButtons("idle");
      }
    }, 1000);
  });

  batchPauseBtn.addEventListener("click", async () => {
    abortController?.abort();
    await chrome.runtime.sendMessage({ kind: "batch-pause" } as any);
    setBatchButtons("paused");
  });

  batchResumeBtn.addEventListener("click", async () => {
    abortController = new AbortController();
    await chrome.runtime.sendMessage({ kind: "batch-resume" } as any);
    setBatchButtons("running");
  });

  batchCancelBtn.addEventListener("click", async () => {
    abortController?.abort();
    await chrome.runtime.sendMessage({ kind: "batch-cancel" } as any);
    setBatchButtons("idle");
    batchProgressEl.style.display = "none";
  });

    document.getElementById("openShortcuts")?.addEventListener("click", () => {
      chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    });

    document.getElementById("clearHistory")?.addEventListener("click", async () => {
      if (!confirm("This will remove the deduplication cache. Previously saved conversations may be re-downloaded. Continue?")) return;
      await chrome.storage.local.remove("history_v1");
      const status = document.getElementById("status");
      if (status) {
        status.textContent = "Save history cleared.";
        setTimeout(() => (status.textContent = ""), 2000);
      }
    });

    document.getElementById("save")?.addEventListener("click", async () => {
    const enabledFormats = [] as ExportFormat[];
    if (fmtJsonEl.checked) enabledFormats.push("json");
    if (fmtMdEl.checked) enabledFormats.push("md");
    if (fmtHtmlEl.checked) enabledFormats.push("html");
    if (fmtPdfEl.checked) enabledFormats.push("pdf");

    const perProvider = {
      claude: provClaudeEl.checked,
      chatgpt: provChatgptEl.checked,
      gemini: provGeminiEl.checked,
      deepseek: provDeepseekEl.checked,
      kimi: provKimiEl.checked,
      grok: provGrokEl.checked,
      copilot: provCopilotEl.checked,
      unknown: false,
    };

    await saveSettings({
      folder: folderEl.value,
      filenameTemplate: templateEl.value,
      showFloatingButton: btnEl.checked,
      titlePrefixIgnore: titlePrefixEl.value.trim(),
      language: languageEl.value as "en" | "pl",
      enabledFormats,
      perProvider,
      batchConcurrency: parseInt(batchConcurrencyEl.value) || 2,
      saveAttachments: bulkSaveAttachmentsEl.checked,
      downloadAttachments: bulkDownloadAttachmentsEl.checked,
      bulkDefaultFormat: bulkDefaultFormatEl.value as "md" | "txt" | "pdf",
    } as any);

    await applyI18n();

    const status = document.getElementById("status");
    if (status) {
      status.textContent = "Settings saved.";
      setTimeout(() => (status.textContent = ""), 2000);
    }
  });
});