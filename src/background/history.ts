import type { ExportFormat, HistoryEntry, ProviderId } from "../core/types";

const HISTORY_KEY = "history_v1";
const HISTORY_LIMIT = 100;

export async function getHistory(): Promise<HistoryEntry[]> {
  const r = await chrome.storage.local.get(HISTORY_KEY);
  return r[HISTORY_KEY] || [];
}

export async function pushHistory(e: HistoryEntry) {
  const cur = await getHistory();
  cur.unshift(e);
  await chrome.storage.local.set({ [HISTORY_KEY]: cur.slice(0, HISTORY_LIMIT) });
}
