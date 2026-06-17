import type { Conversation, Part, Message } from "./types";
import { repairFences } from "./fence";
import { toPdf } from "./serializers-pdf";

const ROLE_LABEL: Record<string, string> = {
  user: "🧑 User",
  assistant: "🤖 Assistant",
  system: "⚙️ System",
  tool: "🛠️ Tool"
};

const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  kimi: "Kimi",
  grok: "Grok",
  copilot: "Copilot",
  unknown: "Unknown"
};

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function yaml(v: any) {
  if (v == null) return '""';
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  if (/[:#\n"'\[\]{}&*!|>%@`,]/.test(s) || /^\s|\s$/.test(s)) return JSON.stringify(s);
  return s;
}

function partToMd(p: Part): string {
  switch (p.type) {
    case "text":
      return p.markdown.trim();
    case "code":
      return "```" + (p.lang ?? "") + "\n" + p.code.replace(/\n$/, "") + "\n```";
    case "thinking":
      return `<details><summary>🧠 Thinking</summary>\n\n${p.markdown.trim()}\n\n</details>`;
    case "tool_use":
      return `<details><summary>🛠️ Tool call — ${escapeHtml(p.name)}</summary>\n\n\`\`\`json\n${JSON.stringify(p.input ?? null, null, 2)}\n\`\`\`\n\n</details>`;
    case "tool_result":
      return `<details><summary>🛠️ Tool result — ${escapeHtml(p.name)}</summary>\n\n\`\`\`\n${p.output}\n\`\`\`\n\n</details>`;
    case "image":
      return `![${p.alt ?? ""}](${p.src})`;
    case "attachment":
      return `📎 **Attachment:** ${p.name}${p.mime ? ` (${p.mime})` : ""}`;
    case "artifact": {
      const head = `**📄 Artifact:** ${p.title}${p.lang ? ` (${p.lang})` : ""}${p.href ? ` — [open](${p.href})` : ""}`;
      if (p.code) {
        return `${head}\n\n\`\`\`${p.lang ?? ""}\n${p.code.replace(/\n$/, "")}\n\`\`\``;
      }
      return `${head}\n\n> _Artifact body not captured._`;
    }
  }
}

function messageToMd(m: Message): string {
  const stamp = m.createdAt ? ` _(${m.createdAt})_` : "";
  const head = `## ${ROLE_LABEL[m.role] ?? m.role}${stamp}`;
  const body = m.parts.map(partToMd).join("\n\n");
  const repaired = repairFences(body);
  return `${head}\n\n${repaired.text}`;
}

export function toMarkdown(c: Conversation): string {
  const fm = [
    "---",
    `schema_version: ${c.schemaVersion}`,
    `provider: ${yaml(c.provider)}`,
    `provider_label: ${yaml(PROVIDER_LABEL[c.provider])}`,
    c.providerModel ? `model: ${yaml(c.providerModel)}` : "",
    `title: ${yaml(c.title)}`,
    `url: ${yaml(c.url)}`,
    `captured_at: ${yaml(c.capturedAt)}`,
    `message_count: ${c.messages.length}`,
    c.warnings.length ? `warnings:\n${c.warnings.map((w) => `  - ${yaml(w)}`).join("\n")}` : "",
    "---",
    "",
    `# ${c.title}`,
    ""
  ].filter(Boolean).join("\n");
  
  const body = c.messages.map(messageToMd).join("\n\n---\n\n");
  return `${fm}\n${body}\n`;
}

export function toJson(c: Conversation): string {
  return JSON.stringify(c, null, 2);
}

function partToHtml(p: Part): string {
  switch (p.type) {
    case "text":
      return p.markdown.split(/\n{2,}/).map((para) => `<p>${escapeHtml(para).replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>")}</p>`).join("\n");
    case "code":
      return `<pre><code class="language-${escapeHtml(p.lang ?? "")}">${escapeHtml(p.code)}</code></pre>`;
    case "thinking":
      return `<details class="thinking" open><summary>🧠 Thinking</summary><div>${escapeHtml(p.markdown).replace(/\n/g, "<br>")}</div></details>`;
    case "tool_use":
      return `<details class="tool"><summary>🛠️ Tool call — ${escapeHtml(p.name)}</summary><pre><code>${escapeHtml(JSON.stringify(p.input ?? null, null, 2))}</code></pre></details>`;
    case "tool_result":
      return `<details class="tool"><summary>🛠️ Tool result — ${escapeHtml(p.name)}</summary><pre><code>${escapeHtml(p.output)}</code></pre></details>`;
    case "image":
      return `<img src="${escapeHtml(p.src)}" alt="${escapeHtml(p.alt ?? "")}" loading="lazy">`;
    case "attachment":
      return `<p class="attachment">📎 <b>Attachment:</b> ${escapeHtml(p.name)}${p.mime ? ` (${escapeHtml(p.mime)})` : ""}</p>`;
    case "artifact":
      return `<section class="artifact"><h3>📄 ${escapeHtml(p.title)}${p.lang ? ` <span class="lang">${escapeHtml(p.lang)}</span>` : ""}${p.href ? ` <a href="${escapeHtml(p.href)}">↗</a>` : ""}</h3>${p.code ? `<pre><code class="language-${escapeHtml(p.lang ?? "")}">${escapeHtml(p.code)}</code></pre>` : `<p class="muted"><em>Artifact body not captured.</em></p>`}</section>`;
  }
}

export function toHtml(c: Conversation): string {
  const messages = c.messages.map((m) => {
    const stamp = m.createdAt ? ` <time>${escapeHtml(m.createdAt)}</time>` : "";
    return `<section class="msg role-${m.role}"><h2>${ROLE_LABEL[m.role] ?? m.role}${stamp}</h2>${m.parts.map(partToHtml).join("\n")}</section>`;
  }).join("\n");
  
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(c.title)} — ${escapeHtml(PROVIDER_LABEL[c.provider])}</title>
<meta name="generator" content="AI Chat Archiver">
<style>
:root { color-scheme: light dark; --fg:#1a1a1a; --bg:#fff; --muted:#666; --accent:#4f46e5; --code-bg:#f5f5f7; --border:#e5e5ea; }
@media (prefers-color-scheme: dark) { :root { --fg:#e7e7ea; --bg:#0f0f12; --muted:#9aa0a6; --accent:#8b5cf6; --code-bg:#1c1c21; --border:#2a2a31; } }
body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; max-width: 820px; margin: 32px auto; padding: 0 16px; color: var(--fg); background: var(--bg); }
header.meta { border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 24px; }
header.meta h1 { margin: 0 0 6px; font-size: 26px; }
header.meta .muted { color: var(--muted); font-size: 13px; }
.msg { padding: 18px 0; border-bottom: 1px solid var(--border); }
.msg h2 { margin: 0 0 12px; font-size: 15px; color: var(--accent); }
.msg time { font-weight: 400; color: var(--muted); margin-left: 8px; font-size: 12px; }
.role-user h2 { color: #0ea5e9; }
pre { background: var(--code-bg); padding: 12px 14px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
:not(pre) > code { background: var(--code-bg); padding: 1px 5px; border-radius: 4px; font-size: 0.92em; }
details { margin: 10px 0; padding: 8px 12px; background: var(--code-bg); border-radius: 8px; border: 1px solid var(--border); }
details > summary { cursor: pointer; font-weight: 600; }
details.thinking { border-color: var(--accent); }
.artifact { margin: 12px 0; padding: 12px 14px; border: 1px solid var(--accent); border-radius: 8px; background: var(--code-bg); }
.artifact h3 { margin: 0 0 8px; font-size: 14px; }
.artifact .lang { background: var(--accent); color: #fff; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 500; margin-left: 4px; }
.artifact .muted { color: var(--muted); margin: 0; }
img { max-width: 100%; border-radius: 8px; }
.warnings { background: #fef3c7; color: #78350f; padding: 8px 12px; border-radius: 6px; font-size: 13px; margin-bottom: 16px; }
@media (prefers-color-scheme: dark) { .warnings { background: #422006; color: #fde68a; } }
.warnings ul { margin: 4px 0 0; padding-left: 20px; }
</style>
</head>
<body>
<header class="meta">
  <h1>${escapeHtml(c.title)}</h1>
  <div class="muted">${escapeHtml(PROVIDER_LABEL[c.provider])}${c.providerModel ? ` · ${escapeHtml(c.providerModel)}` : ""} · ${escapeHtml(c.capturedAt)} · <a href="${escapeHtml(c.url)}">source</a></div>
</header>
${c.warnings.length ? `<div class="warnings"><b>Warnings (${c.warnings.length}):</b><ul>${c.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>` : ""}
${messages}
</body>
</html>`;
}

export function serialize(c: Conversation, format: string) {
  if (format === "md") return { text: toMarkdown(c), mime: "text/markdown", ext: "md" };
  if (format === "html") return { text: toHtml(c), mime: "text/html", ext: "html" };
  if (format === "pdf") return toPdf(c);
  return { text: toJson(c), mime: "application/json", ext: "json" };
}

