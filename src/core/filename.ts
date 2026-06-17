import type { Conversation } from "./types";

const RESERVED_RE = /[<>:"/\\|?*\x00-\x1f]/g;

/** Normalize a string to be filesystem-safe. Removes diacritics, truncates to `max` chars. */
export function slugify(input: string, max = 80): string {
  if (!input) return "untitled";
  const norm = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(RESERVED_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, "-")
    .replace(/-+/g, "-")
    .slice(0, max)
    .replace(/^-+|-+$/g, "");
  return norm || "untitled";
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, "0");
}

/** Build a map of template tokens from a Conversation object. */
function tokens(c: Conversation) {
  const d = new Date(c.capturedAt);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const datetime = `${date.replace(/-/g, "")}-${time}`;
  
  return {
    provider: c.provider,
    title: slugify(c.title),
    date,
    time,
    datetime,
    model: c.providerModel ? slugify(c.providerModel, 40) : "model",
    chatId: c.chatId ?? "",
  };
}

/** Build a full file path from a template string, conversation data, extension, and folder. */
export function buildFilename(template: string, conv: Conversation, ext: string, folder: string): string {
  const t = tokens(conv) as Record<string, string>;
  let path = template.replace(/\{(\w+)\}/g, (_, k) => t[k] ?? "");
  path = path
    .split("/")
    .filter(Boolean)
    .map((seg) => seg.replace(RESERVED_RE, "-"))
    .join("/");
    
  if (folder) {
    const safeFolder = folder
      .split("/")
      .filter(Boolean)
      .map((s) => s.replace(RESERVED_RE, "-"))
      .join("/");
    path = `${safeFolder}/${path}`;
  }
  
  return `${path}.${ext}`;
}