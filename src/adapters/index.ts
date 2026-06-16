import type { ProviderAdapter } from "./base";
import { claudeAdapter } from "./claude";
import { chatgptAdapter } from "./chatgpt";
import { geminiAdapter } from "./gemini";
import { deepseekAdapter } from "./deepseek";
import { kimiAdapter } from "./kimi";
import { grokAdapter } from "./grok";
import { copilotAdapter } from "./copilot";

export const ADAPTERS: ProviderAdapter[] = [
  claudeAdapter,
  chatgptAdapter,
  geminiAdapter,
  deepseekAdapter,
  kimiAdapter,
  grokAdapter,
  copilotAdapter
];

export function adapterFor(url: string | URL): ProviderAdapter | undefined {
  const u = typeof url === "string" ? new URL(url) : url;
  return ADAPTERS.find((a) => a.match(u));
}
