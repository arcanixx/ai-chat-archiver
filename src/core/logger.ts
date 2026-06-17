export const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };
const KEY = "log_buffer_v1";
const MAX = 500;

/** Promise chain acting as a simple mutex to prevent concurrent log writes. */
let logQueue = Promise.resolve();

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
  const logFn = level === "debug" ? console.log : console[level];
  logFn(`[ai-archiver] ${msg}`, data ?? "");
  
  try {
    // Chain writes sequentially to prevent race conditions
    logQueue = logQueue.then(async () => {
      const cur = await readLogs();
      cur.push(entry);
      await writeLogs(cur);
    });
    await logQueue;
  } catch (e) {
    console.error("Failed to write log to storage", e);
  }
}

export function createLogger(namespace: string) {
  return {
    debug: (m: string, d?: any) => log("debug", `[${namespace}] ${m}`, d),
    info: (m: string, d?: any) => log("info", `[${namespace}] ${m}`, d),
    warn: (m: string, d?: any) => log("warn", `[${namespace}] ${m}`, d),
    error: (m: string, d?: any) => log("error", `[${namespace}] ${m}`, d),
  };
}

export const logger = {
  debug: (m: string, d?: any) => log("debug", m, d),
  info: (m: string, d?: any) => log("info", m, d),
  warn: (m: string, d?: any) => log("warn", m, d),
  error: (m: string, d?: any) => log("error", m, d),
  getAll: readLogs,
  clear: async () => { await chrome.storage.local.remove(KEY); },
};
