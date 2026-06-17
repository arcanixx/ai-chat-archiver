import { expandUntilStable, nodeToParts, readTimestamp, type ProviderAdapter } from "./base";
import { logger } from "../core/logger";
import { extractAttachmentsFromDocument } from "../core/attachments";
import type { Attachment, Message, Part } from "../core/types";

export const claudeAdapter: ProviderAdapter = {
  id: "claude",
  match: (u) => u.hostname.endsWith("claude.ai"),
  isFullyExpandedView: (u) => u.pathname.startsWith("/share/"),
  
  getTitle(doc) {
    const headerTitle =
      doc.querySelector('[data-testid="chat-menu-trigger"]')?.textContent?.trim() ||
      doc.querySelector('[data-testid="page-header"] h1')?.textContent?.trim();
    if (headerTitle) return headerTitle;
    
    const firstHeading = doc.querySelector(".font-claude-response h1, .font-claude-response h2");
    if (firstHeading?.textContent?.trim()) return firstHeading.textContent.trim();
    
    return doc.title.replace(/\s*[-–|]\s*Claude.*$/i, "").trim() || "Untitled conversation";
  },
  
  async expandAll(doc) {
    logger.debug("Starting expandAll for Claude", { url: doc.location?.href || "unknown" });
    
    await expandUntilStable(doc, [
      // Thinking/reasoning blocks
      'button[aria-label*="Thinking" i]',
      'button[aria-label*="Reasoning" i]',
      'button[aria-label*="Thought" i]',
      'button[aria-label*="Show" i]',
      'button[aria-label*="Expand" i]',
      'button[aria-label*="Collapse" i]',
      'button[aria-expanded="false"][data-state]',
      'button[aria-expanded="false"]',
      // Details/summary
      'details summary',
      'summary[aria-expanded="false"]',
      // Any collapsed section with clickable parent
      '[role="button"][aria-expanded="false"]',
    ]);
    
    // Second pass: click any expandable sections by text content
    const allButtons = doc.querySelectorAll<HTMLElement>('button, [role="button"]');
    for (const btn of allButtons) {
      if (btn.closest('nav, header, [role="navigation"]')) continue;
      const text = (btn.textContent || '').toLowerCase().trim();
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const expanded = btn.getAttribute('aria-expanded');
      if (expanded === 'false' || text.includes('thinking') || text.includes('reasoning') || text.includes('thought') || label.includes('think') || label.includes('reason') || label.includes('expand') || label.includes('show')) {
        try {
          btn.click();
        } catch {}
      }
    }
    
    // Open all <details> elements  
    doc.querySelectorAll('details:not([open])').forEach((d) => ((d as HTMLDetailsElement).open = true));
    
    // Expand artifact content sections
    const artifactExpanders = doc.querySelectorAll<HTMLElement>([
      'button[aria-label*="artifact" i]',
      'button[aria-label*="code" i]',
      'button[aria-label*="Open in" i]',
      'button[aria-label*="View source" i]',
      '[class*="artifact"] button',
      '[data-testid*="artifact"] button',
      'div[class*="artifact"] button',
    ].join(','));
    artifactExpanders.forEach((b) => {
      try {
        const text = (b.textContent || '').toLowerCase();
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        if ((text.includes('expand') || text.includes('show') || label.includes('expand') || label.includes('show')) && !b.closest('nav')) {
          b.click();
        }
      } catch {}
    });
    
    await new Promise((r) => setTimeout(r, 2000));
    logger.debug("expandAll completed");
  },
  
  extract(doc) {
    logger.debug("Starting extraction for Claude", { url: doc.location?.href || "unknown" });
    const messages: Message[] = [];
    
    try {
      const userBlocks = Array.from(doc.querySelectorAll('[data-testid="user-message"]'));
      const assistantBlocks = Array.from(doc.querySelectorAll(".font-claude-response"));
      
      logger.debug("Found message blocks", { userCount: userBlocks.length, assistantCount: assistantBlocks.length });
      
      const all = [
        ...userBlocks.map((el) => ({ role: "user" as const, el })),
        ...assistantBlocks.map((el) => ({ role: "assistant" as const, el })),
      ].sort((a, b) => (a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1));
      
      logger.debug("Sorted message blocks", { totalCount: all.length });
      
      for (const { role, el } of all) {
        try {
          const parts = nodeToParts(el);
          logger.debug("Extracted parts from message", { role, partCount: parts.length });
          
          if (role === "assistant") {
            const artifactCards = findArtifactCards(el);
            logger.debug("Found artifact cards", { count: artifactCards.length });
            
            for (const card of artifactCards) {
              try {
                const title =
                  card.querySelector("h3, h4, [class*='title']")?.textContent?.trim() ||
                  card.textContent?.trim().slice(0, 80) ||
                  "Artifact";
                const codeEl = card.querySelector("pre code") as HTMLElement;
                const code = codeEl?.innerText || codeEl?.textContent;
                const lang = (codeEl?.className.match(/language-([\w+-]+)/) || [])[1];
                
                if (code) {
                  parts.push({ type: "artifact", title, lang, code });
                  logger.debug("Added artifact with code", { title, lang, codeLength: code.length });
                } else {
                  parts.push({ type: "artifact", title, lang, code: "" });
                  logger.debug("Added artifact without code", { title, lang });
                }
              } catch (e: any) {
                logger.warn("Failed to process artifact card", { error: e.message });
              }
            }
          }
          
          if (parts.length) {
            const createdAt = readTimestamp(el);
            messages.push({ role, parts, createdAt });
            logger.debug("Added message", { role, partCount: parts.length, createdAt });
          }
        } catch (e: any) {
          logger.error("Failed to extract message", { role, error: e.message });
        }
      }
      
      try {
        const globalArtifacts = findGlobalArtifacts(doc);
        if (globalArtifacts.length > 0) {
          logger.debug("Found global artifacts", { count: globalArtifacts.length });
          const lastAssistantIdx = messages.findLastIndex((m) => m.role === "assistant");
          if (lastAssistantIdx >= 0) {
            messages[lastAssistantIdx].parts.push(...globalArtifacts);
            logger.debug("Attached global artifacts to last assistant message");
          }
        }
      } catch (e: any) {
        logger.error("Failed to extract global artifacts", { error: e.message });
      }
      
      logger.info("Extraction completed", { 
        totalMessages: messages.length,
        userMessages: messages.filter(m => m.role === "user").length,
        assistantMessages: messages.filter(m => m.role === "assistant").length 
      });
      
      return messages;
    } catch (e: any) {
      logger.error("Extraction failed", { error: e.message, stack: e.stack });
      throw new Error(`Extraction failed: ${e.message}`);
    }
  },

  getOrgId(doc) {
    return getOrgIdFromPage(doc);
  },

  supportsBulk: true,

  async fetchList(authContext: string, limit: number, offset: number) {
    const orgId = authContext;
    if (!orgId) throw new Error("Organization ID required for Claude bulk");

    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations?limit=${limit}&offset=${offset}`;
    const response = await fetch(url, {
      credentials: "include",
      headers: { accept: "*/*" },
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
      items: data.map((item: any) => ({
        id: item.uuid,
        title: item.name || "Untitled",
        url: `https://claude.ai/chat/${item.uuid}`,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
      nextOffset: data.length === limit ? offset + limit : undefined,
      total: data.length,
    };
  },

  async fetchDetail(authContext: string, conversationId: string) {
    const orgId = authContext;
    if (!orgId) throw new Error("Organization ID required for Claude bulk");

    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`;
    const response = await fetch(url, {
      credentials: "include",
      headers: { accept: "*/*" },
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  },

  async parseBulkData(data: any, options: any = {}) {
    const messages: Message[] = [];
    const attachments: Attachment[] = [];
    const warnings: string[] = [];
    const artifactMemory: Record<string, { current: string; title: string; type: string; version: number }> = {};

    const chatMessages = data.chat_messages || [];

    for (const msg of chatMessages) {
      const role = msg.sender === "human" ? "user" : msg.sender === "assistant" ? "assistant" : "tool";
      const contentParts: string[] = [];

      for (const content of msg.content || []) {
        if (!content) continue;

        if (content.type === "text" && content.text) {
          contentParts.push(content.text);
          continue;
        }

        if (content.type === "tool_result") {
          const result = typeof content.content === "string"
            ? content.content
            : content.content?.[0]?.text || content.text || "";
          if (result) contentParts.push(result);
          continue;
        }

        if (content.type === "tool_use") {
          const toolName = content.name || "";
          const input = content.input || {};

          if (toolName === "artifacts") {
            const artifactId = input.id || content.id || input.version_uuid || `artifact-${attachments.length + 1}`;
            const command = input.command || "create";
            const type = input.type || input.textdoc_type || "text/plain";
            const title = input.title || artifactId;

            let contentStr = "";

            if (command === "create" || command === "rewrite") {
              contentStr = typeof input.content === "string"
                ? input.content
                : JSON.stringify(input.content || input, null, 2);
            } else if (command === "update") {
              const current = artifactMemory[artifactId]?.current || "";
              const oldStr = input.old_str || "";
              const newStr = input.new_str || (typeof input.content === "string" ? input.content : "");
              if (current.includes(oldStr)) {
                contentStr = current.replace(oldStr, newStr);
              } else {
                contentStr = `${current}\n\n/* patch_failed: "${oldStr}" not found */\n${newStr}`;
              }
            } else {
              contentStr = typeof input.content === "string"
                ? input.content
                : JSON.stringify(input.content || input, null, 2);
            }

            const version = (artifactMemory[artifactId]?.version || 0) + 1;
            const finalId = input.version_uuid || `${artifactId}-v${version}`;

            if (options.saveAttachments) {
              attachments.push({
                name: `${title} (v${version}).${getExtensionFromMime(type)}`,
                url: `data:text/plain;base64,${btoa(unescape(encodeURIComponent(contentStr)))}`,
                mime: type,
                data: contentStr,
              });
            }

            artifactMemory[artifactId] = {
              current: contentStr,
              title: title,
              type: type,
              version: version,
            };

            contentParts.push(`**[Artifact: ${title} v${version} / ${finalId}]**\n\n\`\`\`${getLanguageFromMime(type)}\n${contentStr}\n\`\`\``);
          } else {
            contentParts.push(`**Tool: ${toolName}**\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``);
          }
          continue;
        }

        if (content.text) contentParts.push(content.text);
      }

      const contentText = contentParts.filter(Boolean).join("\n\n") || " ";
      messages.push({
        role: role as any,
        parts: [{ type: "text", markdown: contentText }],
        createdAt: msg.created_at,
      });
    }

    return {
      title: data.name || "Claude conversation",
      url: `https://claude.ai/chat/${data.uuid}`,
      chatId: data.uuid,
      providerModel: data.model || undefined,
      messages,
      attachments,
      warnings,
    };
  },

  extractAttachments(doc) {
    return extractAttachmentsFromDocument(doc);
  },
};

function getOrgIdFromPage(doc: Document): string | null {
  const html = doc.documentElement.innerHTML;
  const match = html.match(/https:\/\/claude\.ai\/api\/organizations\/([a-f0-9-]{36})/);
  if (match?.[1]) return match[1];

  try {
    const statuses = JSON.parse(sessionStorage.getItem("SSS-cardamom-integration-statuses") || "{}");
    if (statuses?.orgUuid) return statuses.orgUuid;
  } catch {
    // Ignore missing or malformed session storage.
  }

  return null;
}

function getExtensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    "text/plain": "txt",
    "text/markdown": "md",
    "text/html": "html",
    "application/json": "json",
    "text/x-python": "py",
    "text/javascript": "js",
    "text/typescript": "ts",
    "text/x-rust": "rs",
    "text/x-c": "c",
    "text/x-cpp": "cpp",
    "text/x-java": "java",
    "text/x-go": "go",
  };
  return map[mime] || mime.split("/").pop() || "txt";
}

function getLanguageFromMime(mime: string): string {
  const map: Record<string, string> = {
    "text/plain": "text",
    "text/markdown": "markdown",
    "text/html": "html",
    "application/json": "json",
    "text/x-python": "python",
    "text/javascript": "javascript",
    "text/typescript": "typescript",
    "text/x-rust": "rust",
    "text/x-c": "c",
    "text/x-cpp": "cpp",
    "text/x-java": "java",
    "text/x-go": "go",
  };
  return map[mime] || mime.split("/").pop() || "text";
}

function findArtifactCards(assistantBody: Element): Element[] {
  logger.debug("Finding artifact cards in assistant body");
  let scope: Element | null = assistantBody;
  
  for (let i = 0; i < 4 && scope; i++) {
    try {
      const label = Array.from(scope.querySelectorAll("h3, h4, span")).find((n) =>
        /^artifacts?$/i.test((n.textContent || "").trim())
      );
      if (label) {
        logger.debug("Found artifacts label", { text: label.textContent?.slice(0, 50) });
        const grid = label.closest("div")?.nextElementSibling;
        if (grid) {
          const cards = Array.from(grid.querySelectorAll(":scope > *"));
          logger.debug("Found artifact grid with cards", { count: cards.length });
          return cards;
        }
      }
      scope = scope.parentElement;
    } catch (e: any) {
      logger.warn("Error in artifact card search iteration", { iteration: i, error: e.message });
      scope = scope?.parentElement ?? null;
    }
  }
  
  try {
    const possibleCards = assistantBody.querySelectorAll('div[class*="border"]');
    const filteredCards = Array.from(possibleCards).filter(c => c.querySelector('code, pre, svg'));
    logger.debug("Found artifact cards by fallback", { count: filteredCards.length });
    return filteredCards;
  } catch (e: any) {
    logger.error("Fallback artifact card search failed", { error: e.message });
    return [];
  }
}

function findGlobalArtifacts(doc: Document): Part[] {
  logger.debug("Finding global artifacts in document");
  const artifacts: Part[] = [];
  
  const selectors = [
    '[data-testid*="artifact"]',
    '[class*="artifact-panel"]',
    '[class*="artifact-sidebar"]',
    '[class*="artifact-view"]',
    'div[class*="artifact"] > div[class*="content"]',
    'div[class*="artifact"] pre code',
  ];
  
  for (const sel of selectors) {
    try {
      const elements = doc.querySelectorAll(sel);
      logger.debug("Processing global artifacts selector", { selector: sel, elementCount: elements.length });
      
      elements.forEach((el) => {
        try {
          const titleEl = el.querySelector("h3, h4, [class*='title']") || el.closest('[class*="artifact"]')?.querySelector("h3, h4, [class*='title']");
          const title = titleEl?.textContent?.trim() || el.textContent?.trim().slice(0, 80) || "Artifact";
          const codeEl = el.querySelector("pre code") as HTMLElement;
          const code = codeEl?.innerText || codeEl?.textContent || (el.tagName === "CODE" ? el.textContent : "");
          const lang = codeEl?.className.match(/language-([\w+-]+)/)?.[1];
          
          if (code && code.length > 10) {
            artifacts.push({ type: "artifact", title, lang, code });
            logger.debug("Added global artifact", { title, lang, codeLength: code.length });
          }
        } catch (e: any) {
          logger.warn("Failed to process global artifact element", { selector: sel, error: e.message });
        }
      });
    } catch (e: any) {
      logger.error("Error processing global artifacts selector", { selector: sel, error: e.message });
    }
  }
  
  logger.debug("Global artifact search completed", { totalArtifacts: artifacts.length });
  return artifacts;
}
