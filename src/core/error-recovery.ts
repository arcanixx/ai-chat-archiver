import { logger } from "./logger";
import type { ProviderId } from "./types";

export enum ErrorCategory {
  NETWORK = "network",
  AUTHENTICATION = "authentication",
  RATE_LIMIT = "rate_limit",
  PERMISSION = "permission",
  EXTRACTION = "extraction",
  STORAGE = "storage",
  VALIDATION = "validation",
  UNKNOWN = "unknown",
}

export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

export interface ClassifiedError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  originalError: Error;
  provider?: ProviderId;
  url?: string;
  recoverable: boolean;
  suggestedAction: string;
  retryAfter?: number;
  userMessage: string;
}

export interface RecoveryStrategy {
  shouldRetry: boolean;
  delayMs: number;
  maxAttempts: number;
  fallbackAction?: () => Promise<void>;
}

export interface ErrorContext {
  provider?: ProviderId;
  url?: string;
  operation: string;
  timestamp: number;
  attempt: number;
  metadata?: Record<string, unknown>;
}

const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  category: ErrorCategory;
  severity: ErrorSeverity;
  recoverable: boolean;
  suggestedAction: string;
  userMessage: string;
}> = [
  {
    pattern: /network|connection|fetch|timeout|DNS|socket|ECONNREFUSED|ENOTFOUND/i,
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    suggestedAction: "Retry with exponential backoff. Check internet connection.",
    userMessage: "Połączenie sieciowe nie powiodło się. Spróbuj ponownie za chwilę.",
  },
  {
    pattern: /rate limit|too many requests|429|quota exceeded/i,
    category: ErrorCategory.RATE_LIMIT,
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    suggestedAction: "Wait for rate limit to reset. Implement longer delays between requests.",
    userMessage: "Przekroczono limit zapytań. Poczekaj chwilę przed kolejną próbą.",
  },
  {
    pattern: /unauthorized|401|403|forbidden|auth|token|credential|login|session expired/i,
    category: ErrorCategory.AUTHENTICATION,
    severity: ErrorSeverity.HIGH,
    recoverable: false,
    suggestedAction: "User must re-authenticate. Clear stored credentials and prompt login state.",
    userMessage: "Sesja wygasła lub brak uprawnień. Zaloguj się ponownie w serwisie.",
  },
  {
    pattern: /permission|denied|access|blocked|cors|CSP|extension context invalidated/i,
    category: ErrorCategory.PERMISSION,
    severity: ErrorSeverity.HIGH,
    recoverable: false,
    suggestedAction: "Check extension permissions. Reload page to re-establish context.",
    userMessage: "Brak uprawnień. Odśwież stronę i spróbuj ponownie.",
  },
  {
    pattern: /extract|parse|selector|element not found|no messages|empty|undefined.*selector/i,
    category: ErrorCategory.EXTRACTION,
    severity: ErrorSeverity.MEDIUM,
    recoverable: true,
    suggestedAction: "DOM structure may have changed. Wait for page to fully load or try different selector.",
    userMessage: "Nie udało się wyczytać rozmowy. Upewnij się, że strona się w pełni załadowała.",
  },
  {
    pattern: /storage|quota|disk|write|download|save/i,
    category: ErrorCategory.STORAGE,
    severity: ErrorSeverity.HIGH,
    recoverable: true,
    suggestedAction: "Check available disk space. Try saving to different location.",
    userMessage: "Błąd zapisu pliku. Sprawdź miejsce na dysku lub spróbuj zapisać w innym folderze.",
  },
  {
    pattern: /validation|invalid|malformed|schema|format/i,
    category: ErrorCategory.VALIDATION,
    severity: ErrorSeverity.LOW,
    recoverable: false,
    suggestedAction: "Fix data format before retrying.",
    userMessage: "Nieprawidłowy format danych. Skontaktuj się z deweloperem.",
  },
];

export class ErrorRecoveryManager {
  private errorHistory: Array<{ error: ClassifiedError; context: ErrorContext }> = [];
  private maxHistorySize = 100;
  private retryCounts = new Map<string, number>();

  classifyError(error: Error, context: Partial<ErrorContext> = {}): ClassifiedError {
    const message = error.message || String(error);
    const stack = error.stack || "";

    for (const { pattern, category, severity, recoverable, suggestedAction, userMessage } of ERROR_PATTERNS) {
      if (pattern.test(message) || pattern.test(stack)) {
        return {
          category,
          severity,
          message,
          originalError: error,
          provider: context.provider,
          url: context.url,
          recoverable,
          suggestedAction,
          userMessage,
        };
      }
    }

    return {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      message,
      originalError: error,
      provider: context.provider,
      url: context.url,
      recoverable: true,
      suggestedAction: "Review error details and try again.",
      userMessage: "Wystąpił nieoczekiwany błąd. Spróbuj ponownie.",
    };
  }

  getRecoveryStrategy(classified: ClassifiedError, context: ErrorContext): RecoveryStrategy {
    const key = `${context.operation}-${context.provider || "unknown"}-${context.url || "unknown"}`;
    const attempts = this.retryCounts.get(key) || 0;

    const baseStrategies: Record<ErrorCategory, RecoveryStrategy> = {
      [ErrorCategory.NETWORK]: {
        shouldRetry: true,
        delayMs: 2000 * Math.pow(2, attempts),
        maxAttempts: 3,
      },
      [ErrorCategory.RATE_LIMIT]: {
        shouldRetry: true,
        delayMs: 60000 * (attempts + 1),
        maxAttempts: 5,
      },
      [ErrorCategory.AUTHENTICATION]: {
        shouldRetry: false,
        delayMs: 0,
        maxAttempts: 0,
      },
      [ErrorCategory.PERMISSION]: {
        shouldRetry: false,
        delayMs: 0,
        maxAttempts: 0,
        fallbackAction: async () => {
          logger.info("Permission error fallback: requesting page reload");
        },
      },
      [ErrorCategory.EXTRACTION]: {
        shouldRetry: true,
        delayMs: 3000 * (attempts + 1),
        maxAttempts: 3,
        fallbackAction: async () => {
          logger.info("Extraction error fallback: trying alternative extraction");
        },
      },
      [ErrorCategory.STORAGE]: {
        shouldRetry: true,
        delayMs: 1000,
        maxAttempts: 2,
      },
      [ErrorCategory.VALIDATION]: {
        shouldRetry: false,
        delayMs: 0,
        maxAttempts: 0,
      },
      [ErrorCategory.UNKNOWN]: {
        shouldRetry: attempts < 2,
        delayMs: 5000 * (attempts + 1),
        maxAttempts: 2,
      },
    };

    const strategy = baseStrategies[classified.category] || baseStrategies[ErrorCategory.UNKNOWN];
    
    if (attempts >= strategy.maxAttempts) {
      return { ...strategy, shouldRetry: false };
    }

    return strategy;
  }

  recordError(error: ClassifiedError, context: ErrorContext): void {
    this.errorHistory.push({ error, context: { ...context, timestamp: Date.now() } });
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }

    const key = `${context.operation}-${context.provider || "unknown"}-${context.url || "unknown"}`;
    this.retryCounts.set(key, (this.retryCounts.get(key) || 0) + 1);

    logger.error("Error recorded", {
      category: error.category,
      severity: error.severity,
      message: error.message,
      provider: context.provider,
      url: context.url,
      attempt: context.attempt,
    });
  }

  resetRetryCount(context: ErrorContext): void {
    const key = `${context.operation}-${context.provider || "unknown"}-${context.url || "unknown"}`;
    this.retryCounts.delete(key);
  }

  getErrorStats(): Record<ErrorCategory, number> {
    const stats: Record<ErrorCategory, number> = {
      [ErrorCategory.NETWORK]: 0,
      [ErrorCategory.AUTHENTICATION]: 0,
      [ErrorCategory.RATE_LIMIT]: 0,
      [ErrorCategory.PERMISSION]: 0,
      [ErrorCategory.EXTRACTION]: 0,
      [ErrorCategory.STORAGE]: 0,
      [ErrorCategory.VALIDATION]: 0,
      [ErrorCategory.UNKNOWN]: 0,
    };

    for (const { error } of this.errorHistory) {
      stats[error.category]++;
    }

    return stats;
  }

  getRecentErrors(limit = 10): Array<{ error: ClassifiedError; context: ErrorContext }> {
    return this.errorHistory.slice(-limit).reverse();
  }

  exportErrors(): string {
    const lines = [
      "AI Chat Archiver - Error Report",
      `Generated: ${new Date().toISOString()}`,
      `Total Errors: ${this.errorHistory.length}`,
      "",
      "=== ERROR SUMMARY ===",
    ];

    const stats = this.getErrorStats();
    for (const [category, count] of Object.entries(stats)) {
      lines.push(`${category}: ${count}`);
    }

    lines.push("", "=== RECENT ERRORS ===");
    for (const { error, context } of this.getRecentErrors(20)) {
      lines.push([
        `Time: ${new Date(context.timestamp).toISOString()}`,
        `Operation: ${context.operation}`,
        `Provider: ${context.provider || "N/A"}`,
        `URL: ${context.url || "N/A"}`,
        `Attempt: ${context.attempt}`,
        `Category: ${error.category}`,
        `Severity: ${error.severity}`,
        `Message: ${error.message}`,
        `Recoverable: ${error.recoverable}`,
        `Suggested: ${error.suggestedAction}`,
        "---",
      ].join("\n"));
    }

    return lines.join("\n");
  }

  clearHistory(): void {
    this.errorHistory = [];
    this.retryCounts.clear();
  }
}

export const errorRecoveryManager = new ErrorRecoveryManager();

export async function withErrorRecovery<T>(
  operation: () => Promise<T>,
  context: Partial<ErrorContext>
): Promise<{ success: boolean; result?: T; error?: ClassifiedError }> {
  const fullContext: ErrorContext = {
    provider: context.provider,
    url: context.url,
    operation: context.operation || "unknown",
    timestamp: Date.now(),
    attempt: context.attempt || 1,
    metadata: context.metadata,
  };

  try {
    const result = await operation();
    errorRecoveryManager.resetRetryCount(fullContext);
    return { success: true, result };
  } catch (error) {
    const classified = errorRecoveryManager.classifyError(error as Error, fullContext);
    errorRecoveryManager.recordError(classified, fullContext);

    const strategy = errorRecoveryManager.getRecoveryStrategy(classified, fullContext);

    if (strategy.shouldRetry && fullContext.attempt < strategy.maxAttempts) {
      await new Promise(r => setTimeout(r, strategy.delayMs));
      return withErrorRecovery(operation, { ...fullContext, attempt: fullContext.attempt + 1 });
    }

    if (strategy.fallbackAction) {
      try {
        await strategy.fallbackAction();
      } catch {
        // fallback failed, ignore
      }
    }

    return { success: false, error: classified };
  }
}