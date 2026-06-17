let loadedMessages: Record<string, string> | null = null;

function getBrowserLocale(): string {
  try {
    return chrome.i18n.getUILanguage?.()?.split("-")[0] || "en";
  } catch {
    return "en";
  }
}

async function loadMessages(locale: string): Promise<Record<string, string>> {
  try {
    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
    const resp = await fetch(url);
    const data = await resp.json();
    const msgs: Record<string, string> = {};
    for (const [key, val] of Object.entries(data)) {
      msgs[key] = (val as any).message || key;
    }
    return msgs;
  } catch {
    return {};
  }
}

export async function applyI18n(root: Document | Element = document): Promise<void> {
  const settings = await chrome.storage.sync.get({ language: getBrowserLocale() });
  const targetLang = (settings.language || "en") as string;
  const browserLang = getBrowserLocale();

  const useBrowser = targetLang === browserLang;

  if (!useBrowser) {
    loadedMessages = await loadMessages(targetLang);
  } else {
    loadedMessages = null;
  }

  const elements = root.querySelectorAll<HTMLElement>("[data-i18n]");
  for (const el of elements) {
    const key = el.getAttribute("data-i18n");
    if (!key) continue;

    let msg: string | undefined;
    if (useBrowser) {
      msg = chrome.i18n.getMessage(key);
    } else {
      msg = loadedMessages?.[key];
    }

    if (msg) el.textContent = msg;
    if (el.tagName === "INPUT" && el.hasAttribute("placeholder")) {
      el.setAttribute("placeholder", msg || el.getAttribute("placeholder") || "");
    }
  }
}
