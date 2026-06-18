# AI Chat Archiver - Architecture Documentation

## 1. Overview

AI Chat Archiver is a Chrome/Edge extension (Manifest V3) that saves AI conversations from multiple platforms (Claude, ChatGPT, Gemini, DeepSeek, Kimi, Grok, Copilot) to local files in Markdown, HTML, JSON, or PDF formats. Features include a floating save button, batch URL processing, bulk export from conversation lists, attachment extraction, code fence repair, and smart deduplication.

### Key Features
- **7 provider adapters**: Claude, ChatGPT, Gemini, DeepSeek, Kimi, Grok, Copilot
- **4 export formats**: Markdown (with YAML frontmatter), HTML (self-contained with dark/light mode), JSON (deterministic, diffable), PDF
- **Batch processing**: Export up to 30 URLs concurrently (configurable 1–4 tabs)
- **Bulk export**: Fetch conversation lists via API or DOM, export in bulk
- **Rich content extraction**: Thinking blocks, artifacts, tool calls, iframes, code blocks with language detection
- **Attachment handling**: Extract images, documents, and files from conversations; optional local download
- **Code fence repair**: Validate and fix unclosed code fences per message
- **Smart deduplication**: Track saved conversations by chat ID to prevent duplicates
- **Privacy-first**: All processing on-device, no telemetry, no external data transmission

## 2. Architecture Overview

### System Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│  User Interface Layer                                           │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  Popup      │  │  Options Page   │  │  Floating Button    │  │
│  │ (React)     │  │   (React)      │  │   (Content Script)  │  │
│  └─────────────┘  └─────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Service Worker Layer (Background)                              │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  Command    │  │  Batch Queue   │  │  Download Manager   │  │
│  │  Router     │  │  (Concurrency) │  │  (chrome.downloads) │  │
│  └─────────────┘  └─────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Content Script Layer (Per Provider)                           │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  UI Inject  │  │  Adapter        │  │  Message Handler   │  │
│  │  (Button)   │  │  (Extract)      │  │  (Chrome API)      │  │
│  └─────────────┘  └─────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Core Layer (Shared)                                           │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  Logger     │  │  Serializers    │  │  Utilities         │  │
│  │  (Ring Buf) │  │  (MD/HTML/JSON/ │  │  (Fence, Filename, │  │
│  │             │  │   PDF)          │  │   Attachments)     │  │
│  └─────────────┘  └─────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Module Architecture

### 3.1 Entry Points
- **Manifest**: `src/manifest.json` - Extension configuration and permissions
- **Background**: `src/background/index.ts` - Service worker, command router, batch queue, bulk export coordinator
- **Content**: `src/content/index.ts` - Content script injection, floating button, message handling, adapter dispatch
- **Popup**: `src/popup/popup.tsx` - React UI for single save, batch URL entry, history, bulk export trigger
- **Options**: `src/options/options.tsx` - React UI for settings: formats, folder, filename template, per-provider toggles, logging level

### 3.2 Core Modules
- **Logger**: `src/core/logger.ts` - Ring buffer (500 entries) in `chrome.storage.local` with debug/info/warn/error levels
- **Types**: `src/core/types.ts` - TypeScript interfaces: `Conversation`, `Message`, `Part` (union of text, code, thinking, tool_use, etc.), `Attachment`, `Settings`, `HistoryEntry`
- **Settings**: `src/core/settings.ts` - Zod-validated settings with defaults, stored in `chrome.storage.sync`
- **Serializers**: `src/core/serializers.ts` - MD (YAML frontmatter + markdown body), HTML (self-contained inline CSS), JSON (deterministic key order)
- **PDF Export**: `src/core/serializers-pdf.ts` - PDF generation from conversation data
- **Fence Repair**: `src/core/fence.ts` - Validates code fence parity per message, appends missing fences, logs warnings
- **Filename Builder**: `src/core/filename.ts` - Slugify with NFKD, max 80 chars, fallback to `untitled`, supports `{provider}`, `{title}`, `{datetime}` tokens
- **Attachments**: `src/core/attachments.ts` - MIME detection, URL extraction from markdown, filename sanitization, deduplication
- **Batch Processor**: `src/core/batch-processor.ts` - Queue with configurable concurrency (1–4), hidden-tab extraction, retry with exponential backoff
- **Error Recovery**: `src/core/error-recovery.ts` - Error classification, retry strategies, user-facing error messages
- **Bulk Builder**: `src/content/bulk-builder.ts` - Assembles `Conversation` objects from raw API/DOM data
- **Provider URLs**: `src/core/provider-urls.ts` - Matches URLs to provider IDs for cross-referencing

### 3.3 Provider Adapters
- **Base Interface**: `src/adapters/base.ts` - `ProviderAdapter` interface, shared utilities (`expandUntilStable`, `nodeToParts`, `readTimestamp`, `filterUiChromeParts`, `extractDomConversationList`)
- **Registry**: `src/adapters/index.ts` - `adapterFor(url)` selects adapter by hostname matching
- **Individual Adapters** (7 total):
  - `claude.ts` — Titles from `[data-testid="chat-menu-trigger"]`, user messages from `[data-testid="user-message"]`, responses from `.font-claude-response`, artifacts with code extraction (3 strategies: data-testid, class heuristic, orphan pre/code), thinking blocks. expandAll scopes broad selectors to `<main>` to avoid UI chrome, with a separate artifact sidebar expansion pass and language-label code-fold toggle expansion (buttons with short single-word text like "Script"/"Python").
  - `chatgpt.ts` — Roles from `[data-message-author-role]`, content from `[data-message-content]` / `.markdown` / `.prose`, titles from `nav a[aria-current="page"]`
  - `gemini.ts` — `user-query` / `response-container` elements, `.markdown-main-panel` content, `code-block` language patching, `thinking-overlay` extraction
  - `deepseek.ts` — `.ds-message` containers with virtual scroll handling. expandAll uses staged incremental scrolling: divides container height into N stages (proportional to maxKey), scrolls step-by-step with snapshots at each position, with a targeted fill pass for any remaining missing keys. Captures all messages even when virtual scroll unloads off-screen items.
  - `kimi.ts` — `.chat-content-item-user` / `.chat-content-item-assistant` selectors, iframe content extraction, side panel content, attachment extraction with icon-cache URL filtering (excludes `kimi-web-img.moonshot.cn/prod-data/icon-cache-img/` URLs). expandAll handles code execution blocks (`[class*="code-execution"]`, `[class*="sandbox"]`, `[class*="run-code"]`) and language-label toggles.
  - `grok.ts` — `.message-row` / `[data-message-author-role]` selectors, role from attribute or className, `.prose` / `.markdown` content
  - `copilot.ts` — `cib-chat-turn` / `.chat-turn` elements, role from className or `data-role` attribute

All adapters implement `expandAll` (click expandable buttons until DOM stabilizes) and `extract` (walk DOM, build structured `Message[]`).

### 3.4 Bulk Export Architecture
- **BulkAdapter interface** (extends `ProviderAdapter`): `getOrgId`, `getAuthToken`, `fetchList`, `fetchDetail`, `parseBulkData`, `extractAttachments`
- **Claude**: Uses organization API (`/api/organizations/{orgId}/chat_conversations`), fetches with `tree=True` and `render_all_tools=true`, handles artifacts with version tracking and patch application
- **Gemini**: Uses session-based auth (`geminiauth` in sessionStorage), fetches via background relay messages to avoid CORS
- **Kimi**: Tries API first (`/api/conversations`), falls back to DOM extraction from sidebar list
- **DeepSeek, Grok, Copilot**: Support `extractAttachments` via DOM, bulk API pending
- **Fallback**: `extractDomConversationList` in `base.ts` extracts conversation items from any page DOM using generic selectors

## 4. Data Flow

### 4.1 Single Save Flow
1. User clicks floating button or uses `Ctrl+Shift+S`
2. Content script calls `handleSaveConversation()`
3. Adapter runs `expandAll()` (scroll, click expandables, wait for stability)
4. Adapter runs `extract()` to produce `Message[]`
5. `extractAttachments()` collects attachments from DOM
6. Data sent via `chrome.runtime.sendMessage` to service worker
7. Background serializes to requested format(s), calls `chrome.downloads.download()`
8. Toast notification displayed in content script with status and warnings

### 4.2 Batch Save Flow
1. User enters URLs in popup batch textarea (one per line, max 30)
2. Service worker validates URLs against known adapter URLs, deduplicates
3. Creates hidden tabs via `chrome.tabs.create({ active: false })`
4. After `tabs.onUpdated` + stability delay, injects content script via `scripting.executeScript`
5. Extracts conversation, downloads file, closes tab
6. Concurrency controlled by `batchConcurrency` setting (1–4)
7. Progress tracked per-URL: pending → ok/failed → UI updates in popup

### 4.3 Bulk Export Flow
1. User clicks "Bulk Export" in popup, selects provider
2. Adapter `getOrgId` / `getAuthToken` extracts auth context from current page
3. `fetchList()` retrieves conversation list from provider API
4. User selects conversations in popup UI
5. For each selected conversation: `fetchDetail()` retrieves raw data
6. `parseBulkData()` converts raw data to `Conversation` with messages, attachments, warnings
7. Serializes and downloads each conversation

## 5. Data Model (Conversation)

```typescript
interface Conversation {
  schemaVersion: 1;
  provider: 'claude' | 'chatgpt' | 'gemini' | 'deepseek' | 'kimi' | 'grok' | 'copilot' | 'unknown';
  providerModel?: string;          // e.g. "claude-sonnet-4.5" if detected
  chatId?: string;                 // for deduplication
  title: string;
  url: string;
  capturedAt: string;              // ISO 8601
  messages: Message[];
  warnings: string[];              // e.g. "2 unclosed code fences detected"
  attachments?: Attachment[];
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  createdAt?: string;
  parts: Part[];                   // ordered list of content parts
}

type Part =
  | { type: 'text'; markdown: string }
  | { type: 'code'; lang?: string; code: string }
  | { type: 'thinking'; markdown: string }
  | { type: 'tool_use'; name: string; input?: unknown }
  | { type: 'tool_result'; name: string; output: string }
  | { type: 'image'; src: string; alt?: string }
  | { type: 'attachment'; name: string; mime?: string; url?: string; size?: number }
  | { type: 'artifact'; title: string; lang?: string; code?: string; href?: string };
```

## 6. Serialization

Each format has a dedicated `toFormat(conversation)` function in `src/core/serializers.ts`:

- **Markdown**: YAML frontmatter (`provider`, `model`, `title`, `url`, `captured_at`, `message_count`, `warnings`), role headings with emoji labels, code fences with language, thinking as `<details>` blocks, artifacts as formatted sections
- **HTML**: Self-contained `<!doctype html>` with inline CSS (dark/light mode via `prefers-color-scheme`), semantic class names (`.msg.role-user`, `.msg.role-assistant`), code with `language-*` classes, thinking as `<details open>`
- **JSON**: Pretty-printed, deterministic key order, 1:1 with `Conversation` interface, `schemaVersion` for forward compatibility
- **PDF**: Generated via `serializers-pdf.ts` from conversation data, used for PDF output option

## 7. Error Handling

### 7.1 Error Types
- `AdapterNotFoundError`: Unknown URL pattern
- `ExtractionEmptyError`: No messages extracted
- `LoginRequiredError`: Authentication screen detected in batch tab
- `RateLimitedError`: API rate limit hit
- `DownloadBlockedError`: File download failed

### 7.2 Error Recovery (`src/core/error-recovery.ts`)
- Automatic retry with configurable attempts
- Exponential backoff for rate-limited requests
- Graceful degradation when DOM elements are missing
- Logged with context (traceId, provider, url, durationMs)

### 7.3 Logging System
- Levels: debug, info, warn, error
- Ring buffer (500 entries) in `chrome.storage.local`
- Each save operation logged: `{ traceId, provider, url, durationMs, partsCount, warnings, error? }`
- Accessible via Options → Diagnostics tab with export and clear

## 8. Testing Strategy

### 8.1 Test Structure
```
tests/
├── adapters/
│   ├── claude.test.ts        # Claude adapter unit tests
│   ├── chatgpt.test.ts       # ChatGPT adapter unit tests
│   ├── deepseek.test.ts      # DeepSeek adapter unit tests
│   └── kimi.test.ts          # Kimi adapter unit tests (incl. icon-cache filtering)
├── attachments.test.ts       # Attachment extraction and dedup
├── bulk.test.ts              # Bulk data parsing and builder
├── filename.test.ts          # Slugify, uniqueness, collision handling
├── logger.test.ts            # Ring buffer operations
└── serializers.test.ts       # MD/HTML/JSON round-trip, edge cases
```

### 8.2 Test Fixtures
Realistic HTML documents at `src/__fixtures__/<provider>.html` matching each adapter's DOM selectors:
- **Claude**: `[data-testid="user-message"]`, `.font-claude-response`, tables, code with `language-*`, articles, `<time[datetime]>`
- **ChatGPT**: `[data-message-author-role]`, `[data-message-content]`, `.markdown`, `.prose`, `nav a[aria-current]`
- **Gemini**: `user-query`/`response-container`, `query-text`, `.markdown-main-panel`, `code-block`, `thinking-overlay`
- **DeepSeek**: `.ds-message`, `.ds-markdown.ds-assistant-message-main-content`, `.reasoning-content`, tables
- **Kimi**: `.chat-content-item-user`/`-assistant`, `.markdown-container`, `.message-content`, `iframe`, `.side-panel`, `.thinking-content`
- **Grok**: `.message-row[data-message-author-role]`, `.prose`, `.markdown`
- **Copilot**: `cib-chat-turn[data-role]`, role from className or `data-role`

Fixtures include: code blocks, tables, lists, headings, timestamps, thinking blocks, iframes, and "Show more" expandable buttons to fully exercise adapter logic.

## 9. Performance Considerations

### 9.1 Memory Management
- Content scripts clean up event listeners and MutationObservers after extraction
- Background scripts enforce concurrency cap (default 2, configurable 1–4)
- DOM traversal limited to relevant message sections via adapter selectors

### 9.2 Network Efficiency
- Batch processing with concurrent hidden tabs
- Exponential backoff for rate limits (initial 1s, max 30s)
- Deduplication prevents reprocessing same URLs within a batch

### 9.3 File System
- `chrome.downloads` API with `conflictAction: 'uniquify'`
- Configurable subfolder (relative to `Downloads/`)
- Attachment download with dedup by URL

## 10. Security and Privacy

### 10.1 Data Protection
- All processing on-device; no external data transmission
- DOMPurify sanitization for HTML export (XSS prevention)
- No telemetry or analytics without explicit user consent
- CSP in manifest enforces MV3 defaults (no remote code execution)

### 10.2 Permissions
- Minimal set: `downloads`, `storage`, `scripting`, `activeTab`, `tabs`, `commands`
- Host permissions scoped to known provider domains only
- No `<all_urls>` requirement
- User-configurable per-provider enable/disable in Options

## 11. Future Extensibility

### 11.1 Extension Points
- **New Providers**: Add adapter file in `src/adapters/`, register in `index.ts`
- **New Formats**: Add `toFormat()` in serializers, register in `serialize()` dispatch
- **New Features**: Auto-save on tab close, local search index, File System Access API

### 11.2 Migration Path
- Schema versioning (`schemaVersion: 1`) for forward compatibility
- Backward-compatible data model additions (optional fields via `?`)
- Clear error messages for deprecated features
