import type { Attachment, Part } from "./types";

/** Infer MIME type from a URL's file extension. Falls back to application/octet-stream. */
export function getMimeFromUrl(url: string): string {
  const ext = url.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    md: "text/markdown",
    markdown: "text/markdown",
    json: "application/json",
    xml: "application/xml",
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "application/javascript",
    mjs: "application/javascript",
    ts: "application/typescript",
    tsx: "application/typescript",
    py: "text/x-python",
    java: "text/x-java",
    c: "text/x-c",
    cpp: "text/x-cpp",
    h: "text/x-c",
    hpp: "text/x-cpp",
    cs: "text/x-csharp",
    go: "text/x-go",
    rs: "text/x-rust",
    swift: "text/x-swift",
    rb: "text/x-ruby",
    php: "text/x-php",
    sql: "text/x-sql",
    sh: "application/x-sh",
    bash: "application/x-sh",
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
    tar: "application/x-tar",
    gz: "application/gzip",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    ico: "image/x-icon",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
  };
  return map[ext] || "application/octet-stream";
}

/** Remove unsafe characters from a filename string. Returns `fallback` if result is empty. */
export function sanitizeFilename(name: string, fallback = "attachment"): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

/** Render an Attachment as a Markdown link with metadata. */
export function attachmentToMarkdown(att: Attachment): string {
  const meta = [att.mime, att.size ? `${Math.round(att.size)} B` : undefined].filter(Boolean).join(", ");
  const label = att.savedPath || att.url;
  return `**Attachment:** [${att.name}](${label})${meta ? ` (${meta})` : ""}`;
}

/** Append attachment notes to the last message in a conversation. Avoids duplicates. */
export function appendAttachmentNotes(messages: Array<{ parts: Part[] }>, attachments: Attachment[]): void {
  if (!attachments.length || !messages.length) return;
  const last = messages[messages.length - 1];
  const note = attachments.map(attachmentToMarkdown).join("\n");
  if (last.parts.some((p) => p.type === "text" && p.markdown.includes("**Attachment:**"))) return;
  last.parts.push({ type: "text", markdown: note });
}

/** Extract attachment metadata from DOM elements (images, download links). */
export function extractAttachmentsFromElement(el: Element): Attachment[] {
  const attachments: Attachment[] = [];
  const seen = new Set<string>();
  const add = (att: Attachment) => {
    if (!att.url || seen.has(att.url)) return;
    seen.add(att.url);
    attachments.push(att);
  };

  for (const img of Array.from(el.querySelectorAll("img"))) {
    const src = (img as HTMLImageElement).src || img.getAttribute("src") || "";
    const srcLower = src.toLowerCase();
    if (!src || src.startsWith("data:") || srcLower.includes("emoji") || srcLower.includes("avatar")) continue;
    add({
      name: sanitizeFilename(img.getAttribute("alt") || img.getAttribute("title") || `image-${attachments.length + 1}.png`, `image-${attachments.length + 1}.png`),
      url: src,
      mime: "image/*",
      size: (img as HTMLImageElement).naturalWidth || undefined,
    });
  }

  for (const link of Array.from(el.querySelectorAll("a"))) {
    const href = link.href || link.getAttribute("href") || "";
    if (!href || href.startsWith("#")) continue;
    const text = link.textContent?.trim() || link.getAttribute("download") || link.getAttribute("title") || "";
    if (!link.hasAttribute("download") && !/\/(attachment|file|download)s?(\/|[\?#])|\.(pdf|docx?|xlsx?|pptx?|txt|md|json|xml|zip|rar|7z|png|jpe?g|gif|webp|svg|mp4|webm|mp3|wav)$/i.test(href)) continue;
    add({
      name: sanitizeFilename(text || `file-${attachments.length + 1}`, `file-${attachments.length + 1}`),
      url: href,
      mime: getMimeFromUrl(href),
    });
  }

  return attachments;
}

/**
 * Extract attachments from the full document, including iframes and canvases.
 * Handles cross-origin iframe restrictions gracefully.
 */
export function extractAttachmentsFromDocument(doc: Document): Attachment[] {
  const attachments = extractAttachmentsFromElement(doc.body || doc.documentElement);
  const seen = new Set(attachments.map((a) => a.url));

  for (const iframe of Array.from(doc.querySelectorAll("iframe"))) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      const text = iframeDoc?.body?.textContent?.trim() || "";
      if (text.length > 100) {
        const src = iframe.src || iframe.getAttribute("src") || "iframe";
        if (!seen.has(src)) {
          seen.add(src);
          attachments.push({
            name: sanitizeFilename(`iframe-${attachments.length + 1}.txt`, `iframe-${attachments.length + 1}.txt`),
            url: src,
            mime: "text/plain",
            data: text,
          });
        }
      }
    } catch {
      // Cross-origin iframe content is not accessible.
    }
  }

  for (const canvas of Array.from(doc.querySelectorAll("canvas"))) {
    try {
      const dataUrl = (canvas as HTMLCanvasElement).toDataURL("image/png");
      if (!seen.has(dataUrl)) {
        seen.add(dataUrl);
        attachments.push({
          name: sanitizeFilename(`canvas-${attachments.length + 1}.png`, `canvas-${attachments.length + 1}.png`),
          url: dataUrl,
          mime: "image/png",
          data: dataUrl,
        });
      }
    } catch {
      // Tainted canvas; ignore.
    }
  }

  return attachments;
}

export function extractAttachmentsFromText(text: string): Attachment[] {
  const attachments: Attachment[] = [];
  const seen = new Set<string>();
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(text))) {
    const url = match[2];
    if (!seen.has(url)) {
      seen.add(url);
      attachments.push({ name: sanitizeFilename(match[1] || `image-${attachments.length + 1}.png`, `image-${attachments.length + 1}.png`), url, mime: "image/*" });
    }
  }

  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = linkRegex.exec(text))) {
    const url = match[2];
    if (!seen.has(url) && /\.(pdf|docx?|xlsx?|pptx?|txt|md|json|xml|zip|rar|7z|png|jpe?g|gif|webp|svg|mp4|webm|mp3|wav)$/i.test(url)) {
      seen.add(url);
      attachments.push({ name: sanitizeFilename(match[1] || `file-${attachments.length + 1}`, `file-${attachments.length + 1}`), url, mime: getMimeFromUrl(url) });
    }
  }

  return attachments;
}

export function mergeAttachments(...groups: Array<Attachment[] | undefined>): Attachment[] {
  const out: Attachment[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const att of group || []) {
      if (!att.url || seen.has(att.url)) continue;
      seen.add(att.url);
      out.push(att);
    }
  }
  return out;
}
