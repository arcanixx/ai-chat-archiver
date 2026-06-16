export const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };
const KEY = "log_buffer_v1";
const MAX = 500;

export async function readLogs(): Promise<any[]> {
  const r = await chrome.storage.local.get(KEY);
  return r[KEY] || [];
}

export async function writeLogs(entries: any[]) {
  await chrome.storage.local.set({ [KEY]: entries.slice(-MAX) });
}

async function log(level: "debug" | "info" | "warn" | "error", msg: string, data?: any) {
  let minLevel = "info";
  try {
    const s = await chrome.storage.sync.get({ logLevel: "info" });
    minLevel = s.logLevel;
  } catch {}
  
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel as keyof typeof LEVEL_RANK]) return;
  
  const entry = { t: new Date().toISOString(), level, msg, data };
  console[level === "debug" ? "log" : level](`[ai-archiver] ${msg}`, data ?? "");
  
  try {
    const cur = await readLogs();
    cur.push(entry);
    await writeLogs(cur);
  } catch (e) {
    console.error("Failed to write log to storage", e);
  }
}

export const logger = {
  debug: (m: string, d?: any) => log("debug", m, d),
  info: (m: string, d?: any) => log("info", m, d),
  warn: (m: string, d?: any) => log("warn", m, d),
  error: (m: string, d?: any) => log("error", m, d),
  getAll: readLogs,
  clear: () => chrome.storage.local.remove(KEY)
};
