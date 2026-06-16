# AI Chat Archiver - Architecture Documentation

## 1. Overview

AI Chat Archiver is a Chrome/Edge extension (Manifest V3) that allows users to save AI conversations from various platforms (Claude, ChatGPT, Gemini, DeepSeek, Kimi, etc.) to local files in Markdown, HTML, or JSON formats. The extension features a floating save button, batch processing capabilities, and handles complex UI elements like thinking blocks, artifacts, and tool calls.

### Key Features
- **Multi-platform support**: Adapters for 7+ AI chat providers
- **Multiple export formats**: Markdown, HTML, JSON with proper formatting
- **Batch processing**: Export up to 30 URLs simultaneously
- **Real-time extraction**: Expandable sections, thinking blocks, artifacts
- **Smart deduplication**: Prevent saving duplicate conversations
- **Privacy-first**: All processing happens locally, no external data transmission

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
│  │  Router     │  │  (Concurrency) │  │  (File System)     │  │
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
│  │  (Ring Buf) │  │  (MD/HTML/JSON)│  │  (Filename, etc.) │  │
│  └─────────────┘  └─────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 3. Module Architecture

### 3.1 Entry Points
- **Manifest**: `src/manifest.json` - Extension configuration and permissions
- **Background**: `src/background/index.ts` - Service worker, command router, batch queue
- **Content**: `src/content/index.ts` - Content script injection, UI, message handling
- **Popup**: `src/popup/popup.ts` - User interface for single and batch operations
- **Options**: `src/options/options.ts` - Settings management

### 3.2 Core Modules
- **Logger**: `src/core/logger.ts` - Ring buffer logging with chrome.storage.local
- **Types**: `src/core/types.ts` - TypeScript interfaces for data models
- **Settings**: `src/core/settings.ts` - Configuration management
- **Serializers**: `src/core/serializers.ts` - MD/HTML/JSON conversion
- **Utilities**: `src/core/` - Filename builder, fence repair, etc.

### 3.3 Provider Adapters
- **Base Interface**: `src/adapters/base.ts` - Common functions and interfaces
- **Individual Adapters**: `src/adapters/*.ts` - Platform-specific extraction logic
- **Registry**: `src/adapters/index.ts` - Adapter selection by URL pattern

## 4. Data Flow

### 4.1 Single Save Flow
1. User clicks floating button or uses keyboard shortcut
2. Content script calls `handleSaveConversation()`
3. Adapter expands all sections and extracts conversation
4. Data sent to background service worker
5. Background saves file to Downloads folder
6. Toast notification to user

### 4.2 Batch Save Flow
1. User enters URLs in popup batch interface
2. Service worker validates URLs and deduplicates
3. Creates hidden tabs for each URL
4. Injects content scripts and extracts data
5. Downloads files with progress tracking
6. Updates UI with results

## 5. Adapter Contract

### 5.1 ProviderAdapter Interface
```typescript
interface ProviderAdapter {
  id: string;
  match(url: URL): boolean;
  isFullyExpandedView?(url: URL): boolean;
  getTitle(doc: Document): string;
  detectModel?(doc: Document): string | undefined;
  expandAll(doc: Document): Promise<void>;
  extract(doc: Document): Message[];
}
```

### 5.2 Adapter Development Guidelines
- **Do**: 
  - Use CSS selectors that are stable across UI updates
  - Implement proper error handling with try-catch blocks
  - Add logging for debugging (`logger.debug()`, `logger.error()`)
  - Follow the established message structure
  - Test with real HTML fixtures from `docs/html_examples/`

- **Don't**:
  - Use brittle selectors that depend on exact text content
  - Make blocking synchronous calls in the content script
  - Access chrome APIs without proper error handling
  - Store sensitive data in localStorage or chrome.storage
  - Modify the DOM permanently during extraction

### 5.3 Common Patterns
- **Expand All**: Scroll to bottom, click expandable elements, wait for DOM stability
- **Extract**: Walk DOM tree, filter UI chrome, convert to structured parts
- **Error Handling**: Catch DOM exceptions, log with context, provide fallbacks

## 6. Error Handling Strategy

### 6.1 Error Types
- **AdapterNotFoundError**: Unknown URL pattern
- **ExtractionEmptyError**: No messages extracted
- **LoginRequiredError**: Authentication screen detected
- **RateLimitedError**: API quota exceeded
- **DownloadBlockedError**: File download failed

### 6.2 Error Handling Pattern
```typescript
try {
  const result = await adapter.extract(doc);
  logger.info('Extraction successful', { provider, messageCount: result.length });
  return result;
} catch (error) {
  logger.error('Extraction failed', { provider, error: error.message });
  throw new AppError('EXTRACTION_FAILED', { provider, error: error.message });
}
```

### 6.3 Logging System
- **Levels**: debug, info, warn, error
- **Storage**: Ring buffer in chrome.storage.local (max 500 entries)
- **Context**: Include traceId, provider, URL, durationMs
- **Access**: Via options page for debugging

## 7. Testing Strategy

### 7.1 Unit Tests (Vitest)
- **Core Functions**: Logger, serializers, filename builder
- **Adapters**: Snapshot testing with HTML fixtures
- **Utilities**: Fence repair, DOM parsing

### 7.2 Test Structure
```
tests/
├── logger.test.ts          # Ring buffer operations
├── serializers.test.ts     # MD/HTML/JSON conversion
├── filename.test.ts        # Slugify and collision handling
└── adapters/
    ├── claude.test.ts      # Claude adapter with fixtures
    ├── chatgpt.test.ts    # ChatGPT adapter with fixtures
    └── ...                 # Other providers
```

### 7.3 Test Fixtures
- Use trimmed HTML examples from `docs/html_examples/`
- Focus on edge cases: thinking blocks, artifacts, malformed code
- Include both short and long conversation examples

## 8. Performance Considerations

### 8.1 Memory Management
- **Content Scripts**: Clean up event listeners and observers
- **Background Scripts**: Use proper concurrency control (max 2 tabs)
- **DOM Processing**: Limit DOM traversal to relevant sections

### 8.2 Network Efficiency
- **Batch Processing**: Concurrent downloads with backoff
- **Retry Logic**: Exponential backoff for rate limits
- **Cache**: Avoid re-processing same URLs in batch

### 8.3 File System
- **Downloads**: Use chrome.downloads API with proper conflict handling
- **Storage**: chrome.storage.sync for settings, chrome.storage.local for logs
- **Cleanup**: Auto-remove old log entries (ring buffer)

## 9. Security and Privacy

### 9.1 Data Protection
- **Local Processing**: All conversation processing happens on device
- **No Telemetry**: No external data transmission without user consent
- **Sanitization**: DOMPurify for HTML export to prevent XSS

### 9.2 Permissions
- **Minimal**: Only required permissions listed in manifest
- **Domain-scoped**: Host permissions limited to supported providers
- **User Control**: Options page for all configuration

## 10. Future Extensibility

### 10.1 Extension Points
- **New Providers**: Add adapter following existing interface
- **New Formats**: Extend serializers with new output types
- **New Features**: Background workers for auto-save, indexing

### 10.2 Migration Path
- **Schema Versioning**: Conversation model includes schemaVersion
- **Backward Compatibility**: Handle older format gracefully
- **Deprecation**: Clear migration path for removed features

## 11. Development Guidelines

### 11.1 Code Style
- **TypeScript**: Strict mode, no any types, explicit typing
- **Naming**: Clear, descriptive names for functions and variables
- **Structure**: Small functions, single responsibility, max 200 lines per file

### 11.2 Git Workflow
- **Commits**: Conventional commits (feat, fix, docs, test, chore)
- **Branches**: Feature branches for new functionality
- **Reviews**: Code reviews for all changes

### 11.3 Quality Assurance
- **Build**: TypeScript compilation + Vite build
- **Lint**: ESLint + Prettier for code quality
- **Tests**: Unit tests for critical functions, integration tests for adapters

## 12. Troubleshooting

### 12.1 Common Issues
- **Extension Not Loading**: Check manifest.json syntax and permissions
- **Adapter Not Working**: Verify URL patterns and selectors
- **Download Failing**: Check chrome.downloads permissions and path
- **Memory Issues**: Reduce batch size, clean up observers

### 12.2 Debugging
- **Developer Tools**: Use chrome://extensions for extension debugging
- **Logging**: Enable debug logging in options, view logs in diagnostic section
- **Network**: Use chrome://extensions/service-workers for background debugging

---

This architecture document provides a comprehensive guide for understanding and extending the AI Chat Archiver codebase. Follow these guidelines when adding new features or debugging issues.