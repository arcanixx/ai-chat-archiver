import type { Conversation, Message, Part } from "./types";

function escapePdfString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

function partToText(part: Part): string {
  switch (part.type) {
    case "text":
    case "thinking":
      return part.markdown.trim();
    case "code":
      return `\`\`\`${part.lang || ""}\n${part.code.trim()}\n\`\`\``;
    case "tool_use":
      return `Tool call: ${part.name}\n${JSON.stringify(part.input ?? null, null, 2)}`;
    case "tool_result":
      return `Tool result: ${part.name}\n${part.output}`;
    case "image":
      return `[Image: ${part.alt || part.src}]`;
    case "attachment":
      return `Attachment: ${part.name}`;
    case "artifact":
      return `Artifact: ${part.title}\n${part.code || ""}`;
  }
}

function messageToText(message: Message): string {
  return message.parts.map(partToText).filter(Boolean).join("\n\n");
}

function splitLines(text: string, max = 92): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n");
  const lines: string[] = [];
  for (const raw of normalized.split("\n")) {
    if (!raw.trim()) {
      lines.push("");
      continue;
    }
    let line = raw;
    while (line.length > max) {
      const cut = line.slice(0, max).lastIndexOf(" ") > 8 ? line.slice(0, max).lastIndexOf(" ") : max;
      lines.push(line.slice(0, cut).trimEnd());
      line = line.slice(cut).trimStart();
    }
    lines.push(line);
  }
  return lines;
}

export function toPdf(conv: Conversation): { text: string; mime: string; ext: "pdf" } {
  const roleLabel: Record<string, string> = {
    user: "User",
    assistant: "Assistant",
    system: "System",
    tool: "Tool",
  };

  const bodyLines: string[] = [];
  bodyLines.push(`Title: ${conv.title}`);
  bodyLines.push(`Provider: ${conv.provider}`);
  bodyLines.push(`Captured: ${conv.capturedAt}`);
  bodyLines.push(`Source: ${conv.url}`);
  if (conv.providerModel) bodyLines.push(`Model: ${conv.providerModel}`);
  bodyLines.push("");

  for (const message of conv.messages) {
    bodyLines.push(`${roleLabel[message.role] ?? message.role}${message.createdAt ? ` (${message.createdAt})` : ""}`);
    bodyLines.push("-".repeat(40));
    bodyLines.push(...splitLines(messageToText(message)));
    bodyLines.push("");
  }

  if (conv.attachments?.length) {
    bodyLines.push("Attachments");
    bodyLines.push("-".repeat(40));
    for (const attachment of conv.attachments) {
      bodyLines.push(`${attachment.name} - ${attachment.url}`);
    }
    bodyLines.push("");
  }

  if (conv.warnings.length) {
    bodyLines.push("Warnings");
    bodyLines.push("-".repeat(40));
    bodyLines.push(...conv.warnings);
  }

  const lines = splitLines(bodyLines.join("\n"));
  const yStart = 742;
  const lineHeight = 14;
  const maxLinesPerPage = 52;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += maxLinesPerPage) {
    pages.push(lines.slice(i, i + maxLinesPerPage));
  }

  const chunks: Array<{ offset: number; body: string }> = [];
  let offset = 0;
  const add = (body: string) => {
    chunks.push({ offset, body });
    offset += body.length;
  };

  add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  add(`2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((pageLines, index) => {
    const contentBody = [
      "BT",
      "/F1 16 Tf",
      "72 742 Td",
      `(${escapePdfString(conv.title)}) Tj`,
      "/F1 10 Tf",
      "72 720 Td",
      ...pageLines.map((line, i) => `(${escapePdfString(line)}) Tj${i < pageLines.length - 1 ? ` 0 -${lineHeight} Td` : ""}`),
      "ET",
    ].join("\n");
    const contentLength = contentBody.length;
    const pageNumber = 3 + index;
    const contentsNumber = 4 + index;
    add(`${pageNumber} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents ${contentsNumber} 0 R >>\nendobj\n`);
    add(`${contentsNumber} 0 obj\n<< /Length ${contentLength} >>\nstream\n${contentBody}\nendstream\nendobj\n`);
  });

  const fontNumber = 3 + pages.length;
  add(`${fontNumber} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);

  const xrefStart = offset;
  let xref = `xref\n0 ${chunks.length + 1}\n0000000000 65535 f \n`;
  for (const chunk of chunks) {
    xref += `${String(chunk.offset).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${chunks.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return { text: `${chunks.map((c) => c.body).join("")}${trailer}`, mime: "application/pdf", ext: "pdf" };
}
