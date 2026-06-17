import type { ProviderId } from "./types";

/** Return the base URL for a given AI provider. */
export function getProviderBaseUrl(providerId: ProviderId): string {
  switch (providerId) {
    case "claude":
      return "https://claude.ai/";
    case "chatgpt":
      return "https://chatgpt.com/";
    case "gemini":
      return "https://gemini.google.com/app";
    case "deepseek":
      return "https://chat.deepseek.com/";
    case "kimi":
      return "https://kimi.com/";
    case "grok":
      return "https://grok.com/";
    case "copilot":
      return "https://copilot.microsoft.com/";
    default:
      return "https://example.com/";
  }
}

/** Build a conversation URL for a provider by its ID and conversation ID. */
export function getProviderConversationUrl(providerId: ProviderId, conversationId: string): string {
  const id = encodeURIComponent(conversationId);
  switch (providerId) {
    case "claude":
      return `https://claude.ai/chat/${id}`;
    case "chatgpt":
      return `https://chatgpt.com/c/${id}`;
    case "gemini":
      return `https://gemini.google.com/app/${id.startsWith("c_") ? id : `c_${id}`}`;
    case "deepseek":
      return `https://chat.deepseek.com/chat/${id}`;
    case "kimi":
      return `https://kimi.com/chat/${id}`;
    case "grok":
      return `https://grok.com/chat/${id}`;
    case "copilot":
      return `https://copilot.microsoft.com/?convid=${id}`;
    default:
      return getProviderBaseUrl(providerId);
  }
}

/** Check if a URL belongs to a given provider. */
export function providerMatchesUrl(providerId: ProviderId, url: string | URL): boolean {
  const u = typeof url === "string" ? new URL(url) : url;
  const host = u.hostname;
  switch (providerId) {
    case "claude":
      return host === "claude.ai" || host.endsWith(".claude.ai");
    case "chatgpt":
      return host === "chatgpt.com" || host === "chat.openai.com" || host.endsWith(".chatgpt.com") || host.endsWith(".openai.com");
    case "gemini":
      return host === "gemini.google.com" || host.endsWith(".gemini.google.com");
    case "deepseek":
      return host === "chat.deepseek.com" || host.endsWith(".deepseek.com");
    case "kimi":
      return host === "kimi.com" || host === "www.kimi.com" || host.endsWith(".kimi.com");
    case "grok":
      return host === "grok.com" || host === "x.ai" || host.endsWith(".grok.com") || host.endsWith(".x.ai");
    case "copilot":
      return host === "copilot.microsoft.com" || host === "www.bing.com" || host.endsWith(".microsoft.com") || host.endsWith(".bing.com");
    default:
      return false;
  }
}
