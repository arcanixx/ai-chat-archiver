# AI Chat Archiver — Development Guide

## Project Overview

Browser extension (Chrome/Edge Manifest V3) for saving AI chat conversations to local files. Supports 7 providers (Claude, ChatGPT, Gemini, DeepSeek, Kimi, Grok, Copilot) and 4 export formats (Markdown, HTML, JSON, PDF).

## Prerequisites

- Node.js 18+
- npm 9+
- Chrome or Edge browser for testing

## Quick Start

```bash
# Install dependencies
npm install

# Development build with HMR
npm run dev

# Production build
npm run build

# Run tests
npm test

# Lint
npm run lint
```

## Project Structure

```
src/
├── adapters/           # Provider-specific DOM extraction logic
│   ├── base.ts         # ProviderAdapter interface, shared utilities
│   ├── index.ts        # Adapter registry (adapterFor url)
│   ├── claude.ts       # Claude adapter
│   ├── chatgpt.ts      # ChatGPT adapter
│   ├── gemini.ts       # Gemini adapter
│   ├── deepseek.ts     # DeepSeek adapter
│   ├── kimi.ts         # Kimi adapter
│   ├── grok.ts         # Grok adapter
│   └── copilot.ts      # Microsoft Copilot adapter
├── background/         # Service worker (command router, batch, download)
│   └── index.ts
├── content/            # Content scripts (UI injection, adapter dispatch)
│   ├── index.ts
│   └── bulk-builder.ts # Assembles Conversation from raw bulk data
├── core/               # Shared logic
│   ├── types.ts        # All TypeScript interfaces
│   ├── settings.ts     # Settings management with Zod validation
│   ├── logger.ts       # Ring buffer logger
│   ├── serializers.ts  # MD/HTML/JSON serialization
│   ├── serializers-pdf.ts # PDF serialization
│   ├── fence.ts        # Code fence repair
│   ├── filename.ts     # Slugify + filename builder
│   ├── attachments.ts  # Attachment extraction and handling
│   ├── batch-processor.ts # Batch queue with concurrency control
│   ├── error-recovery.ts  # Error classification and retry
│   └── provider-urls.ts   # URL-to-provider matching
├── popup/              # React popup UI
│   ├── popup.tsx
│   └── ...
├── options/            # React options page
│   ├── options.tsx
│   └── ...
├── __fixtures__/       # HTML test fixtures matching provider DOM
│   ├── claude.html
│   ├── chatgpt.html
│   ├── gemini.html
│   ├── deepseek.html
│   ├── kimi.html
│   ├── grok.html
│   └── copilot.html
└── manifest.json       # Extension manifest (MV3)

tests/
├── adapters/
│   ├── claude.test.ts
│   └── chatgpt.test.ts
├── attachments.test.ts
├── bulk.test.ts
├── filename.test.ts
├── logger.test.ts
└── serializers.test.ts
```

## Adding a New Provider

### 1. Create the Adapter

Create `src/adapters/<provider>.ts` implementing the `ProviderAdapter` interface:

```typescript
import { expandUntilStable, nodeToParts, readTimestamp, type ProviderAdapter } from "./base";

export const myAdapter: ProviderAdapter = {
  id: "myprovider",
  match: (u) => u.hostname === "chat.myprovider.com",
  isFullyExpandedView: (u) => u.pathname.startsWith("/share/"),

  getTitle(doc) {
    // Extract title from DOM, with fallbacks
    return doc.title || "Untitled conversation";
  },

  async expandAll(doc) {
    // Click expandable sections until DOM stabilizes
    await expandUntilStable(doc, [
      'button[aria-label*="Show more" i]',
      'button[aria-expanded="false"]',
    ]);
  },

  extract(doc) {
    const messages: Message[] = [];
    // Query DOM for message containers
    // Extract role, parts, timestamps
    // Return structured Message[]
    return messages;
  },
};
```

### 2. Register in Index

Add to `src/adapters/index.ts`:

```typescript
import { myAdapter } from "./myprovider";
export const ADAPTERS = [claudeAdapter, chatgptAdapter, ..., myAdapter];
```

### 3. Create Test Fixture

Create `src/__fixtures__/<provider>.html` with realistic DOM matching your adapter's selectors. Include:
- Message containers with role indicators
- Code blocks with `language-*` classes
- Timestamps via `<time datetime="...">`
- Expandable "Show more" buttons (hidden)
- Tables, lists, headings for format testing

### 4. Write Tests

Create `tests/adapters/<provider>.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { myAdapter } from '../../src/adapters/myprovider';

vi.mock('../../src/core/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('MyProvider Adapter', () => {
  it('should match URLs', () => {
    expect(myAdapter.match(new URL('https://chat.myprovider.com/c/abc'))).toBe(true);
  });

  it('should extract messages', () => {
    // Load fixture HTML, call extract, assert results
  });
});
```

## Adapter Contract

### Required Methods

- **`id: string`** — Unique provider identifier (must match `ProviderId` in types.ts)
- **`match(url: URL): boolean`** — Match provider by hostname
- **`getTitle(doc: Document): string`** — Extract conversation title with fallbacks
- **`expandAll(doc: Document): Promise<void>`** — Click expandable elements until DOM stabilizes
- **`extract(doc: Document): Message[]`** — Walk DOM and produce structured message list

### Optional Bulk Methods

- **`isFullyExpandedView?(url: URL): boolean`** — Skip expandAll for share URLs
- **`detectModel?(doc: Document): string | undefined`** — Detect AI model from DOM
- **`getOrgId?(doc: Document): string | null`** — Extract org ID for API calls
- **`getAuthToken?(doc: Document): string | null`** — Extract auth token
- **`fetchList?(authContext, limit, offset): Promise`** — Fetch conversation list from API
- **`fetchDetail?(authContext, id): Promise`** — Fetch single conversation detail
- **`parseBulkData?(data, options): Promise<...>`** — Convert API response to Conversation
- **`extractAttachments?(doc: Document): Attachment[]`** — Extract attachments from DOM

### Best Practices

1. **Selector stability**: Use `data-testid` or semantic attributes over fragile class names
2. **Fallbacks**: Always chain fallbacks with `||` — `A || B || doc.title || "default"`
3. **Error isolation**: Each message extraction should be in a try-catch so one failure doesn't lose others
4. **Logging**: Use `logger.debug()` for development, `logger.warn()` for recoverable issues, `logger.error()` for failures
5. **UI chrome filtering**: Use `isUiChrome()` or `filterUiChromeParts()` to exclude edit/copy/share buttons
6. **expandAll safety**: Limit iterations (max 8 in `expandUntilStable`), check HTML length stability
7. **Timestamp extraction**: Adapters should look for `<time datetime="...">` and use `readTimestamp()` from base
8. **Virtual scroll handling** (e.g. DeepSeek): Use staged incremental scrolling — divide container height into N stages proportional to `maxKey`, scroll step-by-step with snapshots at each position, then do a targeted fill pass for any remaining missing keys. Never scroll directly to bottom and expect all keys to be captured.
9. **Language-label code-fold expansion** (Claude, Kimi): Add a second pass that clicks buttons with short single-word text matching `/^[a-zA-Z][\w#+.]{0,20}$/` (e.g. "Script", "Python", "JavaScript") to expand hidden code blocks. Skip UI labels via `skipLabels` and scope to `<main>`.
10. **Icon-cache URL filtering** (Kimi): Filter `extractAttachmentsFromElement` results using a regex like `/icon-cache|kimi-web-img\.moonshot\.cn\/prod-data/` to exclude favicon/icon images from CDN URLs that are not real attachments.
11. **expandAll selector scoping** (Claude): Scope broad selectors (`button[aria-expanded="false"]`) to `<main>` to avoid expanding sidebar/nav/header UI chrome, while keeping specific aria-label selectors unscoped for targeted expansion. Always expand artifact sidebars in a separate pass.

## Shared Utilities in `src/adapters/base.ts`

| Function | Purpose |
|---|---|
| `expandUntilStable(doc, selectors, maxIter?)` | Click elements matching selectors, scroll, wait for DOM stability. Returns when HTML length stops changing. |
| `clickAll(doc, selectors)` | Click all elements matching given selectors |
| `nodeToParts(root)` | Recursively walk DOM node and convert to `Part[]` — handles headings, lists, tables, code blocks, links, images, bold, italic |
| `readTimestamp(el)` | Extract ISO datetime from `<time datetime>` or `aria-label` |
| `isUiChrome(el)` | Check if element is UI chrome (buttons, icons, action bars) |
| `filterUiChromeParts(parts)` | Remove common UI artifact lines like "Edit", "Copy", "Share" from text parts |
| `extractDomConversationList(doc, limit, offset)` | Extract conversation list from any page DOM using generic selectors (fallback for bulk) |
| `sleep(ms)` | Promise-based delay |

## Serialization (`src/core/serializers.ts`)

### Part to Markdown Mapping

| Part Type | Markdown Output |
|---|---|
| `text` | Plain markdown text |
| `code` | ` ```lang \n code \n ``` ` |
| `thinking` | `<details><summary>🧠 Thinking</summary>content</details>` |
| `tool_use` | `<details><summary>🛠️ Tool call — name</summary>json</details>` |
| `tool_result` | `<details><summary>🛠️ Tool result — name</summary>output</details>` |
| `image` | `![alt](src)` |
| `attachment` | `📎 **Attachment:** name (mime)` |
| `artifact` | `**📄 Artifact:** title (lang)` + code fence |

### Adding a New Export Format

Extend the `serialize()` function in `serializers.ts`:

```typescript
export function serialize(c: Conversation, format: string) {
  if (format === "md") return { text: toMarkdown(c), mime: "text/markdown", ext: "md" };
  if (format === "html") return { text: toHtml(c), mime: "text/html", ext: "html" };
  if (format === "pdf") return toPdf(c);
  if (format === "newformat") return toNewFormat(c);
  return { text: toJson(c), mime: "application/json", ext: "json" };
}
```

## Fixture Guidelines

Test fixtures should exercise the full extraction pipeline. Each fixture should include:

1. **Multiple messages** — At least 3 turns (user → assistant → user → assistant)
2. **Code blocks** — With `language-*` classes (e.g., `language-typescript`, `language-python`)
3. **Tables** — With `<thead>` and `<tbody>` for markdown table conversion
4. **Lists** — Ordered (`<ol>`) and unordered (`<ul>`)
5. **Headings** — `<h1>` through `<h3>` for heading extraction
6. **Timestamps** — `<time datetime="ISO">` for `readTimestamp()`
7. **Expandable buttons** — Hidden buttons with `aria-expanded="false"` and `aria-label="Show more"` to test `expandAll`
8. **Critical thinking blocks** — `<thinking-overlay>`, `.reasoning-content`, etc. matching adapter selectors
9. **UI chrome** — Elements like Copy buttons for `isUiChrome` / `filterUiChromeParts` filtering

Filenames: `<provider>.html` in `src/__fixtures__/`.

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npx vitest tests/serializers.test.ts

# Run with coverage
npx vitest --coverage

# Watch mode
npx vitest --watch
```

### Test Patterns

- **Adapter tests**: Mock logger, create Document from fixture HTML string, call adapter methods, assert against expected structure
- **Serializer tests**: Create `Conversation` objects directly, call `serialize()`, check output for expected patterns, verify round-trip
- **Utility tests**: Pure function inputs/outputs (fence repair, filename builder, attachment extraction)

## Common Pitfalls

1. **DOM not ready**: Always await `expandAll()` before `extract()` in adapter tests
2. **Missing timestamps**: Some providers don't include `<time>` elements; `readTimestamp` returns `undefined`
3. **Hidden elements**: `expandAll` must click buttons that might be scrolled out of view
4. **Cross-origin iframes**: Content scripts can access same-origin iframes; other iframes show "cross-origin, cannot extract" message
5. **Disconnected DOM trees**: `compareDocumentPosition` for sorting messages may return unexpected results; use DOM position with fallback to document order

## Debugging

- Enable debug logging in Options → Diagnostics → Log Level
- View logs in Options → Diagnostics → View Logs
- Background service worker debugging: `chrome://extensions` → service worker link
- Content script debugging: Open DevTools on the chat page
- File a bug: https://github.com/anomalyco/opencode/issues
