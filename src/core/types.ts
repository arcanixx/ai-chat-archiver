export type ProviderId =
  | "claude"
  | "chatgpt"
  | "gemini"
  | "deepseek"
  | "kimi"
  | "grok"
  | "copilot"
  | "unknown";

export type Role = "user" | "assistant" | "system" | "tool";

export type ExportFormat = "md" | "html" | "json";

export type Part =
  | { type: "text"; markdown: string }
  | { type: "code"; lang?: string; code: string }
  | { type: "thinking"; markdown: string }
  | { type: "tool_use"; name: string; input?: unknown }
  | { type: "tool_result"; name: string; output: string }
  | { type: "image"; src: string; alt?: string }
  | { type: "attachment"; name: string; mime?: string; url?: string; size?: number }
  | { type: "artifact"; title: string; lang?: string; code?: string; href?: string };

export interface Message {
  role: Role;
  createdAt?: string;
  parts: Part[];
}

export interface Conversation {
  schemaVersion: 1;
  provider: ProviderId;
  providerModel?: string;
  chatId?: string;
  title: string;
  url: string;
  capturedAt: string;
  messages: Message[];
  warnings: string[];
  attachments?: Array<{ name: string; url: string; mime?: string }>;
}

export interface Settings {
  enabledFormats: ExportFormat[];
  folder: string;
  filenameTemplate: string;
  showFloatingButton: boolean;
  floatingButtonPosition?: { x: number; y: number };
  logLevel: "debug" | "info" | "warn" | "error";
  perProvider: Record<ProviderId, boolean>;
  batchConcurrency: number;
  downloadAttachments: boolean;
  titlePrefixIgnore: string;
}

export const DEFAULT_SETTINGS: Settings = {
  enabledFormats: ["md"],
  folder: "AI-Chats",
  filenameTemplate: "{title}__{provider}__{datetime}",
  showFloatingButton: true,
  floatingButtonPosition: undefined,
  logLevel: "info",
  perProvider: {
    claude: true,
    chatgpt: true,
    gemini: true,
    deepseek: true,
    kimi: true,
    grok: true,
    copilot: true,
    unknown: false,
  },
  batchConcurrency: 2,
  downloadAttachments: false,
  titlePrefixIgnore: "",
};

export type RuntimeMessage =
  | { kind: "extract-and-save"; formats: ExportFormat[] }
  | { kind: "extract-only" }
  | { kind: "save-conversation"; conversation: Conversation; formats: ExportFormat[] }
  | { kind: "save-selection"; text: string; html?: string; filename?: string }
  | { kind: "batch-start"; urls: string[]; formats: ExportFormat[] }
  | { kind: "batch-status" }
  | { kind: "get-history" }
  | { kind: "get-logs" }
  | { kind: "clear-logs" }
  | { kind: "open-batch-ui" };

export interface HistoryEntry {
  id: string;
  at: string;
  provider: ProviderId;
  title: string;
  url: string;
  chatId?: string;
  filename: string;
  formats: ExportFormat[];
  warnings: number;
  messageCount: number;
}

export interface TrackedChat {
  chatId: string;
  provider: ProviderId;
  title: string;
  url: string;
  lastSavedAt: string;
  lastMessageCount: number;
  filenames: string[];
}
