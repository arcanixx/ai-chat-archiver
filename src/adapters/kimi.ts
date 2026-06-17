import { expandUntilStable, nodeToParts, readTimestamp, filterUiChromeParts, type ProviderAdapter } from "./base";
import type { Message, Part } from "../core/types";

async function extractIframeContent(container: Element): Promise<Part[]> {
  const parts: Part[] = [];
  const iframes = container.querySelectorAll("iframe");
  
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        const text = iframeDoc.body?.textContent?.trim();
        if (text && text.length > 50) {
          const src = iframe.src || iframe.getAttribute("src") || "unknown";
          parts.push({ 
            type: "text", 
            markdown: `**Iframe content (${src}):**\n\n${text}` 
          });
        }
      }
    } catch {
      // Cross-origin iframe - can't access content
      const src = iframe.src || iframe.getAttribute("src") || "unknown";
      parts.push({ 
        type: "text", 
        markdown: `**Iframe detected (cross-origin, cannot extract):** ${src}` 
      });
    }
  }
  return parts;
}

async function extractSidePanelContent(doc: Document): Promise<Part[]> {
  const parts: Part[] = [];
  
  // Look for side panel / file preview containers
  const sidePanelSelectors = [
    '[class*="side-panel"]',
    '[class*="file-preview"]',
    '[class*="artifact-panel"]',
    '[class*="sandbox"]',
    '[class*="preview-panel"]',
    '.chat-sidebar',
    '[data-testid*="side"]',
    '[data-testid*="preview"]',
  ];
  
  for (const selector of sidePanelSelectors) {
    const panels = doc.querySelectorAll(selector);
    for (const panel of panels) {
      const text = panel.textContent?.trim();
      if (text && text.length > 50) {
        // Check if this looks like file content (has code, markdown, etc.)
        if (/```|\.md|function|class|import|def |const |# /.test(text)) {
          parts.push({ 
            type: "text", 
            markdown: `**Side panel content:**\n\n${text}` 
          });
        }
      }
    }
  }
  return parts;
}

export const kimiAdapter: ProviderAdapter = {
  id: "kimi",
  match: (u) => /(^|\.)kimi\.com$/.test(u.hostname),
  isFullyExpandedView: (u) => /\/share\//.test(u.pathname),
  
  getTitle(doc) {
    const fromTitle = doc.title.replace(/\s*[-–|]\s*Kimi.*$/i, "").trim();
    if (fromTitle) return fromTitle;
    
    const fromName = doc.querySelector(".chat-name")?.textContent?.trim();
    return fromName || "Kimi conversation";
  },
  
  async expandAll(doc) {
    await expandUntilStable(doc, [
      'button[aria-expanded="false"]',
      'div[class*="thinking"] button',
      'div[class*="reason"] button',
    ]);
  },
  
  async extract(doc) {
    const messages: Message[] = [];
    const turns = Array.from(doc.querySelectorAll(".chat-content-item-user, .chat-content-item-assistant"));
    
    for (const el of turns) {
      const role = el.classList.contains("chat-content-item-user") ? "user" : "assistant";
      
      const body = el.querySelector(".markdown-container") ?? el;
      
      let parts = filterUiChromeParts(nodeToParts(body));
      
      const thinking = el.querySelector('[class*="thinking"], [class*="reason"]');
      if (thinking && thinking !== body) {
        const t = thinking.textContent?.trim();
        if (t) {
          parts.unshift({ type: "thinking", markdown: t });
        }
      }
      
      // Extract iframe content from this message
      const iframeParts = await extractIframeContent(el);
      parts.push(...iframeParts);
      
      if (parts.length) {
        messages.push({ role, parts, createdAt: readTimestamp(el) });
      }
    }
    
    // Also extract side panel content (file previews, sandbox files) as a separate "system" message
    const sidePanelParts = await extractSidePanelContent(doc);
    if (sidePanelParts.length) {
      messages.push({ 
        role: "assistant", 
        parts: sidePanelParts, 
        createdAt: new Date().toISOString() 
      });
    }
    
    return messages;
  },
};
