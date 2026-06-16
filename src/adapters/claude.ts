import { expandUntilStable, nodeToParts, readTimestamp, type ProviderAdapter } from "./base";
import { logger } from "../core/logger";
import type { Message, Part } from "../core/types";

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
    
    return doc.title.replace(/\s*[-–|]\s*Claude.*$/i, "").trim() || "Claude conversation";
  },
  
  async expandAll(doc) {
    logger.debug("Starting expandAll for Claude", { url: doc.location?.href || "unknown" });
    
    try {
      await expandUntilStable(doc, [
        'button[aria-label*="Thinking" i]',
        'button[aria-label*="Reasoning" i]',
        'button[aria-label*="Show more" i]',
        'button[aria-expanded="false"][data-state]',
      ]);
      logger.debug("Initial expansion completed");
    } catch (e: any) {
      logger.error("Initial expansion failed", { error: e.message });
      throw e;
    }
    
    const artifactSelectors = [
      'button[aria-label*="Open in side panel" i]',
      'button[aria-label*="View source" i]',
      'button[aria-label*="Expand" i]',
      'button[aria-label*="Show" i]',
      '[data-testid*="artifact"] button',
      '[class*="artifact"] button',
      'div[class*="artifact"] > button',
      'div[class*="artifact"] button:first-child',
    ];
    
    let clickCount = 0;
    for (const sel of artifactSelectors) {
      try {
        const buttons = doc.querySelectorAll<HTMLElement>(sel);
        buttons.forEach((b) => {
          try {
            if (!b.closest('nav')) {
              if (b.innerText?.match(/created.*file/i)) {
                logger.debug("Clicking artifact creation button", { text: b.innerText.slice(0, 50) });
                b.click();
                clickCount++;
              } else if (b.innerText?.match(/(expand|show)/i)) {
                logger.debug("Clicking expand/show button", { text: b.innerText.slice(0, 50) });
                b.click();
                clickCount++;
              }
            }
          } catch (e: any) {
            logger.warn("Failed to click button", { selector: sel, error: e.message });
          }
        });
      } catch (e: any) {
        logger.error("Error processing artifact selector", { selector: sel, error: e.message });
      }
    }
    
    logger.debug("Artifact expansion completed", { clickCount });
    
    // Wait for any opened artifact panels to load content
    await new Promise((r) => setTimeout(r, 1500));
    logger.debug("Waiting period completed");
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
      
      // First pass: extract messages and in-message artifacts
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
      
      // Second pass: find artifacts in sidebar/panel (global to document)
      // These are artifacts created during the conversation but rendered in a separate panel
      try {
        const globalArtifacts = findGlobalArtifacts(doc);
        if (globalArtifacts.length > 0) {
          logger.debug("Found global artifacts", { count: globalArtifacts.length });
          // Attach global artifacts to the last assistant message (or create a synthetic one)
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
};

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
  
  // Look for artifact panels in the sidebar or dedicated artifact area
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
          // Find title
          const titleEl = el.querySelector("h3, h4, [class*='title']") || el.closest('[class*="artifact"]')?.querySelector("h3, h4, [class*='title']");
          const title = titleEl?.textContent?.trim() || el.textContent?.trim().slice(0, 80) || "Artifact";
          
          // Find code
          const codeEl = el.querySelector("pre code") as HTMLElement;
          const code = codeEl?.innerText || codeEl?.textContent || (el.tagName === "CODE" ? el.textContent : "");
          const lang = codeEl?.className.match(/language-([\w+-]+)/)?.[1];
          
          if (code && code.length > 10) { // Only add if there's substantial code
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
