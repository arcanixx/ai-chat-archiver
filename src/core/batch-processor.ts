import { logger } from "./logger";
import type { Conversation, ExportFormat, ProviderId } from "./types";

export interface BatchProcessorConfig {
  maxConcurrent: number;
  retryPolicy: {
    maxAttempts: number;
    delayMs: number;
    backoffMultiplier: number;
  };
  rateLimit: {
    requestsPerMinute: number;
    burstSize: number;
  };
}

export interface BatchJob<T> {
  id: string;
  url: string;
  provider: ProviderId;
  priority: number;
  data?: T;
  status: "pending" | "running" | "completed" | "failed" | "paused";
  attempt: number;
  result?: Conversation;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface BatchProgress {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  paused: number;
  currentUrl?: string;
  estimatedTimeRemaining?: number;
}

export type BatchProgressCallback = (progress: BatchProgress) => void;
export type BatchJobCallback = (job: BatchJob<unknown>) => void;

const DEFAULT_CONFIG: BatchProcessorConfig = {
  maxConcurrent: 2,
  retryPolicy: {
    maxAttempts: 3,
    delayMs: 1000,
    backoffMultiplier: 2,
  },
  rateLimit: {
    requestsPerMinute: 30,
    burstSize: 5,
  },
};

export class ConversationBatchProcessor {
  config: BatchProcessorConfig;
  private queue: BatchJob<unknown>[] = [];
  private activeJobs = new Map<string, BatchJob<unknown>>();
  private completedJobs = new Map<string, BatchJob<unknown>>();
  private failedJobs = new Map<string, BatchJob<unknown>>();
  private progressCallbacks = new Set<BatchProgressCallback>();
  private jobCallbacks = new Set<BatchJobCallback>();
  private isPaused = false;
  private isProcessing = false;
  private rateLimitTokens: number;
  private lastTokenRefill = Date.now();
  private abortController: AbortController | null = null;

  constructor(config: Partial<BatchProcessorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rateLimitTokens = this.config.rateLimit.burstSize;
  }

  onProgress(callback: BatchProgressCallback): () => void {
    this.progressCallbacks.add(callback);
    return () => this.progressCallbacks.delete(callback);
  }

  onJobUpdate(callback: BatchJobCallback): () => void {
    this.jobCallbacks.add(callback);
    return () => this.jobCallbacks.delete(callback);
  }

  private emitProgress() {
    const progress: BatchProgress = {
      total: this.queue.length + this.activeJobs.size + this.completedJobs.size + this.failedJobs.size,
      pending: this.queue.filter(j => j.status === "pending").length,
      running: this.activeJobs.size,
      completed: this.completedJobs.size,
      failed: this.failedJobs.size,
      paused: this.queue.filter(j => j.status === "paused").length,
      currentUrl: Array.from(this.activeJobs.values())[0]?.url,
    };

    const completed = this.completedJobs.size + this.failedJobs.size;
    if (completed > 0 && progress.total > 0) {
      const elapsed = Date.now() - (this.getStartTime() || Date.now());
      const rate = completed / (elapsed / 1000);
      if (rate > 0) {
        progress.estimatedTimeRemaining = (progress.pending + progress.running) / rate * 1000;
      }
    }

    for (const cb of this.progressCallbacks) {
      try { cb(progress); } catch { }
    }
  }

  private emitJobUpdate(job: BatchJob<unknown>) {
    for (const cb of this.jobCallbacks) {
      try { cb(job); } catch { }
    }
  }

  private getStartTime(): number | undefined {
    const allJobs = [...this.queue, ...this.activeJobs.values(), ...this.completedJobs.values(), ...this.failedJobs.values()];
    const started = allJobs.filter(j => j.startedAt).map(j => j.startedAt!);
    return started.length ? Math.min(...started) : undefined;
  }

  private refillRateLimitTokens() {
    const now = Date.now();
    const elapsed = now - this.lastTokenRefill;
    const tokensToAdd = Math.floor((elapsed / 60000) * this.config.rateLimit.requestsPerMinute);
    if (tokensToAdd > 0) {
      this.rateLimitTokens = Math.min(
        this.config.rateLimit.burstSize,
        this.rateLimitTokens + tokensToAdd
      );
      this.lastTokenRefill = now;
    }
  }

  private async waitForRateLimit(): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        this.refillRateLimitTokens();
        if (this.rateLimitTokens > 0) {
          this.rateLimitTokens--;
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  addJob(url: string, provider: ProviderId, priority = 0, data?: unknown): string {
    const id = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const job: BatchJob<unknown> = {
      id,
      url,
      provider,
      priority,
      data,
      status: "pending",
      attempt: 0,
    };
    this.queue.push(job);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.emitProgress();
    return id;
  }

  addJobs(jobs: Array<{ url: string; provider: ProviderId; priority?: number; data?: unknown }>): string[] {
    return jobs.map(j => this.addJob(j.url, j.provider, j.priority, j.data));
  }

  setMaxConcurrent(n: number): void {
    this.config.maxConcurrent = Math.max(1, Math.min(10, n));
  }

  pause(): void {
    this.isPaused = true;
    for (const job of this.activeJobs.values()) {
      job.status = "paused";
      this.emitJobUpdate(job);
    }
    this.emitProgress();
    logger.info("Batch processor paused");
  }

  resume(): void {
    this.isPaused = false;
    this.emitProgress();
    this.processQueue();
    logger.info("Batch processor resumed");
  }

  cancel(jobId?: string): void {
    if (jobId) {
      const job = this.activeJobs.get(jobId) || this.queue.find(j => j.id === jobId);
      if (job) {
        job.status = "failed";
        job.error = "Cancelled by user";
        this.emitJobUpdate(job);
        this.activeJobs.delete(jobId);
        this.failedJobs.set(jobId, job);
      }
    } else {
      this.isPaused = true;
      this.abortController?.abort();
      for (const job of this.activeJobs.values()) {
        job.status = "failed";
        job.error = "Batch cancelled";
        this.emitJobUpdate(job);
        this.failedJobs.set(job.id, job);
      }
      this.activeJobs.clear();
      this.queue = [];
    }
    this.emitProgress();
    logger.info("Batch processor cancelled", { jobId });
  }

  async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.abortController = new AbortController();

    try {
      while (!this.isPaused && !this.abortController.signal.aborted) {
        this.refillRateLimitTokens();

        const availableSlots = this.config.maxConcurrent - this.activeJobs.size;
        if (availableSlots <= 0) {
          await this.sleep(200);
          continue;
        }

        const nextJobs = this.queue
          .filter(j => j.status === "pending")
          .slice(0, availableSlots);

        if (nextJobs.length === 0) {
          if (this.activeJobs.size === 0) break;
          await this.sleep(200);
          continue;
        }

        for (const job of nextJobs) {
          if (this.isPaused || this.abortController.signal.aborted) break;
          await this.waitForRateLimit();
          this.executeJob(job);
        }

        await this.sleep(100);
      }
    } finally {
      this.isProcessing = false;
      this.emitProgress();
    }
  }

  private async executeJob(job: BatchJob<unknown>): Promise<void> {
    job.status = "running";
    job.attempt++;
    job.startedAt = job.startedAt || Date.now();
    this.queue = this.queue.filter(j => j.id !== job.id);
    this.activeJobs.set(job.id, job);
    this.emitJobUpdate(job);
    this.emitProgress();

    try {
      await this.waitForRateLimit();
      
      const result = await this.extractConversation(job.url, job.provider);
      
      job.status = "completed";
      job.result = result;
      job.completedAt = Date.now();
      this.activeJobs.delete(job.id);
      this.completedJobs.set(job.id, job);
      this.emitJobUpdate(job);
      logger.info("Batch job completed", { id: job.id, url: job.url, messages: result.messages.length });
    } catch (error: any) {
      job.error = error.message;
      logger.error("Batch job failed", { id: job.id, url: job.url, error: error.message, attempt: job.attempt });

      if (job.attempt < this.config.retryPolicy.maxAttempts && !this.abortController?.signal.aborted) {
        job.status = "pending";
        const delay = this.config.retryPolicy.delayMs * Math.pow(this.config.retryPolicy.backoffMultiplier, job.attempt - 1);
        logger.info("Scheduling retry", { id: job.id, delay, attempt: job.attempt + 1 });
        setTimeout(() => {
          this.queue.unshift(job);
          this.activeJobs.delete(job.id);
          this.emitJobUpdate(job);
          this.processQueue();
        }, delay);
      } else {
        job.status = "failed";
        job.completedAt = Date.now();
        this.activeJobs.delete(job.id);
        this.failedJobs.set(job.id, job);
        this.emitJobUpdate(job);
      }
    }

    this.emitProgress();
  }

  private async extractConversation(url: string, provider: ProviderId): Promise<Conversation> {
    const response = await chrome.runtime.sendMessage({
      kind: "batch-extract",
      url,
      provider,
    } as any);
    
    if (!response.ok) {
      throw new Error(response.error || "Extraction failed");
    }
    return response.conversation;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getResults(): Map<string, Conversation | Error> {
    const results = new Map<string, Conversation | Error>();
    for (const [id, job] of this.completedJobs) {
      if (job.result) results.set(id, job.result);
    }
    for (const [id, job] of this.failedJobs) {
      results.set(id, new Error(job.error || "Unknown error"));
    }
    return results;
  }

  getProgress(): BatchProgress {
    return {
      total: this.queue.length + this.activeJobs.size + this.completedJobs.size + this.failedJobs.size,
      pending: this.queue.filter(j => j.status === "pending").length,
      running: this.activeJobs.size,
      completed: this.completedJobs.size,
      failed: this.failedJobs.size,
      paused: this.queue.filter(j => j.status === "paused").length,
      currentUrl: Array.from(this.activeJobs.values())[0]?.url,
    };
  }

  getJob(id: string): BatchJob<unknown> | undefined {
    return this.activeJobs.get(id) 
      || this.completedJobs.get(id) 
      || this.failedJobs.get(id)
      || this.queue.find(j => j.id === id);
  }

  getAllJobs(): BatchJob<unknown>[] {
    return [
      ...this.queue,
      ...this.activeJobs.values(),
      ...this.completedJobs.values(),
      ...this.failedJobs.values(),
    ];
  }

  clearCompleted(): void {
    this.completedJobs.clear();
    this.emitProgress();
  }

  clearFailed(): void {
    this.failedJobs.clear();
    this.emitProgress();
  }

  retryFailed(): void {
    for (const [id, job] of this.failedJobs) {
      job.status = "pending";
      job.attempt = 0;
      job.error = undefined;
      this.queue.unshift(job);
      this.emitJobUpdate(job);
    }
    this.failedJobs.clear();
    this.emitProgress();
    this.processQueue();
  }
}

export const batchProcessor = new ConversationBatchProcessor();