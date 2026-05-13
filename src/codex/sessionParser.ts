import { readFile } from "node:fs/promises";
import { ContextEvent } from "../types.js";
import { firstString, safeJsonParse, textFromUnknown } from "../text.js";

interface ParseOptions {
  sessionId?: string;
  cwd?: string;
  path?: string;
}

export function extractCodexEventsFromJsonl(raw: string, options: ParseOptions = {}): Omit<ContextEvent, "timestamp">[] {
  const events: Omit<ContextEvent, "timestamp">[] = [];
  let cwd = options.cwd;
  let sessionId = options.sessionId;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = safeJsonParse(line);
    if (!parsed || typeof parsed !== "object") continue;
    const record = parsed as Record<string, unknown>;

    const payload = record.payload && typeof record.payload === "object" ? record.payload as Record<string, unknown> : undefined;
    if (!cwd) cwd = firstString(record.cwd, record.workspace, payload?.cwd);
    if (!sessionId) sessionId = firstString(record.session_id, record.sessionId, record.id, payload?.id);

    const event = eventFromRecord(record, { cwd, sessionId, path: options.path });
    if (event) events.push(event);
  }

  return events;
}

export async function extractCodexEventsFromFile(path: string, options: ParseOptions = {}): Promise<Omit<ContextEvent, "timestamp">[]> {
  return extractCodexEventsFromJsonl(await readFile(path, "utf8"), { ...options, path });
}

function eventFromRecord(record: Record<string, unknown>, options: ParseOptions): Omit<ContextEvent, "timestamp"> | undefined {
  const type = firstString(record.type);
  const payload = record.payload && typeof record.payload === "object" ? record.payload as Record<string, unknown> : undefined;
  if (type === "event_msg" && payload?.type === "user_message") {
    return buildEvent("user", firstString(payload.message, payload.text_elements), type, options);
  }

  if (type === "event_msg" && payload?.type === "agent_message") {
    return buildEvent("assistant", firstString(payload.message), type, options);
  }

  if (type === "response_item" && payload?.type === "message") {
    const role = firstString(payload.role);
    if (role === "user" || role === "assistant") {
      return buildEvent(role, firstString(payload.content, payload.message), type, options);
    }
  }

  const item = record.item && typeof record.item === "object" ? record.item as Record<string, unknown> : undefined;
  const role = firstString(record.role, item?.role, record.message && (record.message as Record<string, unknown>).role);

  const text = firstString(record.message, record.text, record.content, item?.content, item);
  const effectiveRole = role ?? roleFromType(type);
  if (!text || !effectiveRole) return undefined;

  if (effectiveRole !== "user" && effectiveRole !== "assistant") return undefined;

  return buildEvent(effectiveRole, text, type, options);
}

function buildEvent(
  role: "user" | "assistant",
  text: string | undefined,
  rawType: string | undefined,
  options: ParseOptions
): Omit<ContextEvent, "timestamp"> | undefined {
  if (!text) return undefined;
  return {
    type: role === "user" ? "ai_prompt_submitted" : "ai_response_finished",
    source: "codex-cli-log",
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    text,
    metadata: {
      logPath: options.path,
      rawType,
      role
    }
  };
}

function roleFromType(type: string | undefined): "user" | "assistant" | undefined {
  if (!type) return undefined;
  if (type === "user_message" || type === "user") return "user";
  if (type === "assistant_message" || type === "assistant") return "assistant";
  return undefined;
}

export function describeCodexRecord(record: unknown): string | undefined {
  return textFromUnknown(record);
}
