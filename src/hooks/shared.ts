import { readFile } from "node:fs/promises";
import { ContextEvent, IncomingContextEvent } from "../types.js";
import { firstString, safeJsonParse, textFromUnknown } from "../text.js";

export async function readStdinJson(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

export function hookEventName(input: Record<string, unknown>): string {
  return firstString(input.hook_event_name, input.hookEventName, input.event, input.event_name, input.name) ?? "unknown";
}

export function sessionIdFrom(input: Record<string, unknown>): string | undefined {
  return firstString(input.session_id, input.sessionId, input.session?.["id" as never]);
}

export function cwdFrom(input: Record<string, unknown>): string | undefined {
  return firstString(input.cwd, input.workspace, input.workspace_root);
}

export function metadataFrom(input: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    hookEventName: hookEventName(input),
    ...extra
  };

  const transcriptPath = firstString(input.transcript_path, input.transcriptPath, input.transcript);
  if (transcriptPath) metadata.transcript_path = transcriptPath;
  const logPath = firstString(input.log_path, input.logPath, input.session_log_path);
  if (logPath) metadata.logPath = logPath;
  const turnId = firstString(input.turn_id, input.turnId);
  if (turnId) metadata.turnId = turnId;
  return metadata;
}

export function baseEvent(input: Record<string, unknown>, type: IncomingContextEvent["type"], source: string): Omit<ContextEvent, "timestamp"> {
  const event: Omit<ContextEvent, "timestamp"> = {
    type,
    source,
    metadata: metadataFrom(input)
  };
  const cwd = cwdFrom(input);
  const sessionId = sessionIdFrom(input);
  if (cwd) event.cwd = cwd;
  if (sessionId) event.sessionId = sessionId;
  return event;
}

export async function findLastAssistantTextFromJsonl(path: string): Promise<string | undefined> {
  const raw = await readFile(path, "utf8");
  let last: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = safeJsonParse(line);
    if (!parsed || typeof parsed !== "object") continue;
    const record = parsed as Record<string, unknown>;
    const role = firstString(record.role, record.type, record.message && (record.message as Record<string, unknown>).role);
    const isAssistant = role === "assistant" || role === "assistant_message";
    if (!isAssistant) continue;
    const text = firstString(record.content, record.message, record.text, record.item);
    if (text) last = text;
  }
  return last;
}

export function promptTextFrom(input: Record<string, unknown>): string | undefined {
  return firstString(input.prompt, input.user_prompt, input.userPrompt, input.message, input.input, input.text);
}

export function assistantTextFrom(input: Record<string, unknown>): string | undefined {
  return firstString(input.last_assistant_message, input.lastAssistantMessage, input.assistant_message, input.response, input.output, textFromUnknown(input.message));
}
