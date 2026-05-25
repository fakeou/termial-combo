import { readFile, stat } from "node:fs/promises";
import { IncomingContextEvent } from "../types.js";
import { safeJsonParse } from "../text.js";

export interface ClaudeHistoryTailerOptions {
  historyPath: string;
  pollMs?: number;
  startAtEnd?: boolean;
  onEvent: (event: IncomingContextEvent) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}

export class ClaudeHistoryTailer {
  private readonly historyPath: string;
  private readonly pollMs: number;
  private readonly startAtEnd: boolean;
  private readonly onEvent: (event: IncomingContextEvent) => void | Promise<void>;
  private readonly onError?: (error: unknown) => void | Promise<void>;
  private offset = 0;
  private pending = "";
  private timer: NodeJS.Timeout | undefined;
  private polling = false;

  constructor(options: ClaudeHistoryTailerOptions) {
    this.historyPath = options.historyPath;
    this.pollMs = options.pollMs ?? 1000;
    this.startAtEnd = options.startAtEnd ?? true;
    this.onEvent = options.onEvent;
    this.onError = options.onError;
  }

  async initialize(): Promise<void> {
    try {
      const info = await stat(this.historyPath);
      this.offset = this.startAtEnd ? info.size : 0;
    } catch (error) {
      this.offset = 0;
      await this.onError?.(error);
    }
  }

  async start(): Promise<void> {
    await this.initialize();
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, this.pollMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const raw = await readFile(this.historyPath);
      if (raw.length < this.offset) {
        this.offset = 0;
        this.pending = "";
      }
      if (raw.length === this.offset) return;

      const chunk = raw.subarray(this.offset).toString("utf8");
      this.offset = raw.length;
      await this.processChunk(chunk);
    } catch (error) {
      await this.onError?.(error);
    } finally {
      this.polling = false;
    }
  }

  private async processChunk(chunk: string): Promise<void> {
    const text = this.pending + chunk;
    const lines = text.split(/\r?\n/);
    this.pending = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseClaudeHistoryLine(line, this.historyPath);
      if (event) await this.onEvent(event);
    }
  }
}

export function parseClaudeHistoryLine(line: string, historyPath: string): IncomingContextEvent | undefined {
  const parsed = safeJsonParse(line);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;

  const record = parsed as Record<string, unknown>;
  const text = typeof record.display === "string" ? record.display.trim() : "";
  if (!text || text.startsWith("/")) return undefined;

  const event: IncomingContextEvent = {
    type: "ai_prompt_submitted",
    source: "claude-code",
    text,
    metadata: {
      historyPath,
      promptSource: "claude-history"
    }
  };

  if (typeof record.sessionId === "string" && record.sessionId.trim()) {
    event.sessionId = record.sessionId.trim();
  }

  if (typeof record.project === "string" && record.project.trim()) {
    event.cwd = record.project.trim();
  }

  if (typeof record.timestamp === "number" && Number.isFinite(record.timestamp)) {
    event.timestamp = new Date(record.timestamp).toISOString();
    event.metadata = {
      ...event.metadata,
      claudeHistoryTimestamp: record.timestamp
    };
  }

  return event;
}
