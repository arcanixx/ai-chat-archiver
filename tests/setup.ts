import { vi } from 'vitest';

// Mock chrome API
const mockStorage = {
  local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
  sync: { get: vi.fn().mockResolvedValue({ logLevel: 'info' }), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
};

global.chrome = {
  storage: mockStorage,
  runtime: {
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn(),
    openOptionsPage: vi.fn(),
    getURL: vi.fn((p: string) => p),
    getManifest: vi.fn(() => ({})),
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
  downloads: { download: vi.fn() },
  commands: { onCommand: { addListener: vi.fn() } },
  i18n: { getMessage: vi.fn(() => '') },
} as any;

// Proper DOMParser mock that creates a real DOM tree
class MockDOMParser {
  parseFromString(_string: string, _type: string): Document {
    if (typeof document !== 'undefined') {
      const parser = new DOMParser();
      return parser.parseFromString(_string, _type);
    }
    // Fallback for environments without native DOMParser
    return { documentElement: { innerHTML: _string, querySelectorAll: () => [], querySelector: () => null } } as any;
  }
}
global.DOMParser = MockDOMParser as any;

// Mock performance API
global.performance = { now: vi.fn(() => Date.now()) } as any;

// Suppress console noise
global.console = { ...console, log: vi.fn(), warn: vi.fn(), error: vi.fn() };
