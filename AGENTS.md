# AI Chat Archiver — Agent Guide

## Commands

```bash
npm run dev       # Vite dev server (HMR for extension)
npm run build     # tsc + vite build → ai-chat-archiver-extension/
npm test          # vitest watch mode
npm run test:run  # vitest run (single pass)
```

- `vitest` is **not** in `node_modules/.bin/`; use `npx vitest` or the npm scripts above.

## Testing

- **7 test files**, all in `tests/`:
  - `tests/adapters/claude.test.ts`, `chatgpt.test.ts`
  - `tests/serializers.test.ts`, `attachments.test.ts`, `bulk.test.ts`, `filename.test.ts`, `logger.test.ts`
- Uses `jsdom` environment with `tests/setup.ts` mocking `chrome.*` APIs globally.
- **Fixtures**: HTML test documents live in `src/__fixtures__/<provider>.html` — realistic DOM matching each adapter's actual selectors.
- No integration/E2E tests yet (no Playwright).

## Architecture

- **Chrome MV3 extension** — service worker background, content scripts per provider domain.
- **7 adapters** (`src/adapters/`): claude, chatgpt, gemini, deepseek, kimi, grok, copilot.
- **Adapter interface** (`src/adapters/base.ts`): `match`, `getTitle`, `expandAll`, `extract`.
- **Core types** (`src/core/types.ts`): `Conversation`, `Message`, `Part` (union of text, code, thinking, tool_use, image, artifact, attachment).
- **Serializers** (`src/core/serializers.ts`): `toMarkdown`, `toHtml`, `toJson`, plus `serializers-pdf.ts`.
- **No README.md** yet — check `docs/architecture.md` and `docs/DEVELOPMENT_GUIDE.md` for full docs.

## Project quirks

- Built with `@crxjs/vite-plugin` (CRXJS) — standard Vite but produces a Chrome extension with manifest V3.
- `tsc && vite build` — two-step build (tsc typechecks first). `tsc` is strict mode.
- `public/` is the Vite static dir (contains `_locales/` with `en` and `pl` i18n).
- `src/manifest.json` is the **source of truth** for host permissions and content script matches — loaded by `crx()` plugin.
- `noUnusedLocals: false`, `noUnusedParameters: false` in tsconfig — the compiler will not error on unused vars.

## Fixtures

- `src/__fixtures__/<provider>.html` — created from session work; not yet wired into adapter tests (those use inline `doc` mocks).
- Old `tests/html_fixtures/` was deleted; do not recreate.
- When writing adapter tests, load fixture HTML via `<template>` or `DOMParser` from import — the `tests/setup.ts` has a `MockDOMParser`.

## Adapter development

Each adapter must implement `ProviderAdapter`. Key selectors (current as of June 2026):

| Provider | Messages | Assistant | User |
|---|---|---|---|
| Claude | — | `.font-claude-response` | `[data-testid="user-message"]` |
| ChatGPT | `[data-message-author-role]` | — | — |
| Gemini | — | `response-container` | `user-query` |
| DeepSeek | `.ds-message` | `.ds-markdown.ds-assistant-message-main-content` | (absence of above) |
| Kimi | — | `.chat-content-item-assistant` | `.chat-content-item-user` |
| Grok | `.message-row, [data-message-author-role]` | — | — |
| Copilot | `cib-chat-turn, .chat-turn` | — | role from className or `data-role` |

## Bulk export

- Adapters can optionally implement `BulkAdapter` (claude, gemini, kimi have full support; deepseek/grok/copilot support `extractAttachments` only).
- Claude uses org API; Gemini uses sessionStorage auth; Kimi tries API with DOM fallback.
