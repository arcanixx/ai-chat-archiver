import { DEFAULT_SETTINGS, type Settings } from "./types";

export async function getSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    const settings = { ...DEFAULT_SETTINGS, ...stored } as Settings;
    if (settings.saveAttachments === undefined) settings.saveAttachments = !!settings.downloadAttachments;
    if (settings.downloadAttachments === undefined) settings.downloadAttachments = settings.saveAttachments;
    return settings;
  } catch (e) {
    console.error("Failed to load settings, using defaults.", e);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(settings);
}
