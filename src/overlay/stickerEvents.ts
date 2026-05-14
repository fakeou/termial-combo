import { ContextEvent } from "../types.js";

export type StickerCommandAsset =
  | { type: "emoji"; value: string }
  | { type: "image"; url: string }
  | { type: "gif"; url: string }
  | { type: "video"; url: string };

export interface StickerCommand {
  triggerId: string;
  asset: StickerCommandAsset;
  durationMs: number;
  matchedKeyword?: string;
  ruleId?: string;
}

export function extractNewStickerCommands(
  events: ContextEvent[],
  seenTriggerIds: Set<string>
): StickerCommand[] {
  const commands: StickerCommand[] = [];

  for (const event of events) {
    if (event.type !== "sticker_triggered" || !isRecord(event.metadata)) continue;

    const triggerId = stringValue(event.metadata.triggerId);
    if (!triggerId || seenTriggerIds.has(triggerId)) continue;

    const asset = normalizeAsset(event.metadata.asset);
    if (!asset) continue;

    seenTriggerIds.add(triggerId);
    const command: StickerCommand = {
      triggerId,
      asset,
      durationMs: clampDuration(event.metadata.durationMs)
    };

    const matchedKeyword = stringValue(event.metadata.matchedKeyword);
    if (matchedKeyword) command.matchedKeyword = matchedKeyword;

    const ruleId = stringValue(event.metadata.ruleId);
    if (ruleId) command.ruleId = ruleId;

    commands.push(command);
  }

  return commands;
}

function normalizeAsset(value: unknown): StickerCommandAsset | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;

  if (value.type === "emoji") {
    const emojiValue = stringValue(value.value);
    return emojiValue ? { type: "emoji", value: emojiValue } : undefined;
  }

  if (!isUrlAssetType(value.type)) return undefined;

  const url = stringValue(value.url);
  return url ? { type: value.type, url } : undefined;
}

function clampDuration(value: unknown): number {
  const duration = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 2000;
  return Math.min(5000, Math.max(1, duration));
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isUrlAssetType(value: string): value is "image" | "gif" | "video" {
  return value === "image" || value === "gif" || value === "video";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
