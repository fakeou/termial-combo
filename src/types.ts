export const eventTypes = [
  "ai_prompt_submitted",
  "ai_response_finished",
  "ai_task_started",
  "ai_task_finished",
  "sticker_triggered",
  "active_app_changed",
  "active_window_changed",
  "warp_window_detected",
  "hook_error"
] as const;

export type ContextEventType = (typeof eventTypes)[number];

export type JsonObject = Record<string, unknown>;

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContextEvent {
  type: ContextEventType;
  source: string;
  timestamp: string;
  cwd?: string;
  sessionId?: string;
  text?: string;
  metadata?: JsonObject;
}

export type IncomingContextEvent = Omit<ContextEvent, "timestamp"> & {
  type: ContextEventType | string;
  timestamp?: string;
};

export function isContextEventType(value: unknown): value is ContextEventType {
  return typeof value === "string" && eventTypes.includes(value as ContextEventType);
}

export function normalizeEvent(input: IncomingContextEvent): ContextEvent {
  if (!isContextEventType(input.type)) {
    throw new Error(`Unsupported event type: ${String(input.type)}`);
  }
  if (typeof input.source !== "string" || input.source.trim().length === 0) {
    throw new Error("Event source is required");
  }

  const event: ContextEvent = {
    type: input.type,
    source: input.source,
    timestamp: typeof input.timestamp === "string" ? input.timestamp : new Date().toISOString()
  };

  if (typeof input.cwd === "string") event.cwd = input.cwd;
  if (typeof input.sessionId === "string") event.sessionId = input.sessionId;
  if (typeof input.text === "string") event.text = input.text;
  if (input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)) {
    event.metadata = input.metadata as JsonObject;
  }

  return event;
}
