  import { getSettings, saveSettings } from "../core/settings";
import type { ExportFormat } from "../core/types";

  document.addEventListener("DOMContentLoaded", async () => {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (key) {
        const msg = chrome.i18n.getMessage(key);
        if (msg) el.textContent = msg;
      }
    });

    const folderEl = document.getElementById("folder") as HTMLInputElement;
    const templateEl = document.getElementById("filenameTemplate") as HTMLInputElement;
    const btnEl = document.getElementById("showFloatingButton") as HTMLInputElement;
    const autoSaveEl = document.getElementById("autoSave") as HTMLInputElement;
    const titlePrefixEl = document.getElementById("titlePrefixIgnore") as HTMLInputElement;
    const fmtJsonEl = document.getElementById("fmt-json") as HTMLInputElement;
    const fmtMdEl = document.getElementById("fmt-md") as HTMLInputElement;
    const fmtHtmlEl = document.getElementById("fmt-html") as HTMLInputElement;
    // Provider toggles
    const provClaudeEl = document.getElementById("prov-claude") as HTMLInputElement;
    const provChatgptEl = document.getElementById("prov-chatgpt") as HTMLInputElement;
    const provGeminiEl = document.getElementById("prov-gemini") as HTMLInputElement;
    const provDeepseekEl = document.getElementById("prov-deepseek") as HTMLInputElement;
    const provKimiEl = document.getElementById("prov-kimi") as HTMLInputElement;
    const provGrokEl = document.getElementById("prov-grok") as HTMLInputElement;
    const provCopilotEl = document.getElementById("prov-copilot") as HTMLInputElement;

    const settings = await getSettings();
    folderEl.value = settings.folder;
    templateEl.value = settings.filenameTemplate;
    btnEl.checked = settings.showFloatingButton;
    autoSaveEl.checked = settings.autoSave;
    titlePrefixEl.value = settings.titlePrefixIgnore ?? "";
    // set format checkboxes based on enabledFormats
    fmtJsonEl.checked = settings.enabledFormats.includes("json");
    fmtMdEl.checked = settings.enabledFormats.includes("md");
    fmtHtmlEl.checked = settings.enabledFormats.includes("html");
    // set provider toggles based on perProvider settings
    provClaudeEl.checked = settings.perProvider?.claude ?? true;
    provChatgptEl.checked = settings.perProvider?.chatgpt ?? true;
    provGeminiEl.checked = settings.perProvider?.gemini ?? true;
    provDeepseekEl.checked = settings.perProvider?.deepseek ?? true;
    provKimiEl.checked = settings.perProvider?.kimi ?? true;
    provGrokEl.checked = settings.perProvider?.grok ?? true;
    provCopilotEl.checked = settings.perProvider?.copilot ?? true;

    document.getElementById("save")?.addEventListener("click", async () => {
      const enabledFormats = [] as ExportFormat[];
      if (fmtJsonEl.checked) enabledFormats.push("json");
      if (fmtMdEl.checked) enabledFormats.push("md");
      if (fmtHtmlEl.checked) enabledFormats.push("html");
      // collect perProvider settings
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
        autoSave: autoSaveEl.checked,
        titlePrefixIgnore: titlePrefixEl.value.trim(),
        enabledFormats,
        perProvider,
      } as any);
      const status = document.getElementById("status");
      if (status) {
        status.textContent = "Settings saved.";
        setTimeout(() => (status.textContent = ""), 2000);
      }
    });
  });
