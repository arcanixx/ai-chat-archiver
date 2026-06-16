// Test setup for Vitest
import { vi } from 'vitest';

// Mock chrome API
global.chrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn()
    },
    sync: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn()
    }
  },
  runtime: {
    onMessage: {
      addListener: vi.fn()
    },
    sendMessage: vi.fn(),
    openOptionsPage: vi.fn()
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn()
  },
  downloads: {
    download: vi.fn()
  },
  commands: {
    onCommand: {
      addListener: vi.fn()
    }
  }
};

// Mock DOM APIs
global.DOMParser = class DOMParser {
  parseFromString(string: string, type: string) {
    return new Document();
  }
};

// Mock performance API
global.performance = {
  now: vi.fn(() => Date.now())
};

// Mock console methods to reduce noise during tests
global.console = {
  ...console,
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};