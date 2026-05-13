import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ContextEvent, IncomingContextEvent, normalizeEvent } from "./types.js";

export interface JsonlEventStoreOptions {
  logPath: string;
  recentLimit?: number;
}

export class JsonlEventStore {
  private readonly logPath: string;
  private readonly recentLimit: number;
  private readonly recentEvents: ContextEvent[] = [];

  constructor(options: JsonlEventStoreOptions) {
    this.logPath = options.logPath;
    this.recentLimit = options.recentLimit ?? 100;
  }

  async add(input: IncomingContextEvent): Promise<ContextEvent> {
    const event = normalizeEvent(input);
    await mkdir(dirname(this.logPath), { recursive: true });
    await appendFile(this.logPath, `${JSON.stringify(event)}\n`, "utf8");

    this.recentEvents.push(event);
    if (this.recentEvents.length > this.recentLimit) {
      this.recentEvents.splice(0, this.recentEvents.length - this.recentLimit);
    }
    return event;
  }

  recent(): ContextEvent[] {
    return [...this.recentEvents];
  }
}
