import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ContextEvent } from "./types.js";

export type StickerAsset =
  | { type: "emoji"; value: string }
  | { type: "image"; path: string; url: string }
  | { type: "gif"; path: string; url: string }
  | { type: "video"; path: string; url: string };

export interface StickerRule {
  id: string;
  enabled?: boolean;
  keywords: string[];
  asset: StickerAsset;
  durationMs: number;
}

export const defaultStickerRule: StickerRule = {
  id: "retry-emoji",
  keywords: ["不对", "不行", "重新来"],
  asset: { type: "emoji", value: "😵" },
  durationMs: 2000
};

export interface LoadStickerRulesOptions {
  configPath: string;
  projectRoot: string;
}

export async function loadStickerRules({ configPath, projectRoot }: LoadStickerRulesOptions): Promise<StickerRule[]> {
  try {
    const raw = await readFile(configPath, "utf8");
    return normalizeStickerRules(JSON.parse(raw), projectRoot);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [defaultStickerRule];
    }
    throw error;
  }
}

export function normalizeStickerRules(input: unknown, projectRoot: string): StickerRule[] {
  const rawRules = rawRuleList(input);
  if (!rawRules) return [defaultStickerRule];

  const rules = rawRules.flatMap((rawRule) => {
    const rule = normalizeRule(rawRule, projectRoot);
    return rule ? [rule] : [];
  });

  return rules.length > 0 ? rules : [defaultStickerRule];
}

export function buildStickerTriggerEvents(
  event: ContextEvent,
  rules: StickerRule[]
): Omit<ContextEvent, "timestamp">[] {
  if (event.type !== "ai_prompt_submitted" || typeof event.text !== "string") {
    return [];
  }

  return rules.flatMap((rule, index) => {
    const matchedKeyword = rule.keywords.find((keyword) => event.text?.includes(keyword));
    if (!matchedKeyword) return [];

    return [
      {
        type: "sticker_triggered",
        source: "sticker-rules",
        cwd: event.cwd,
        sessionId: event.sessionId,
        text: event.text,
        metadata: {
          triggerId: `${rule.id}:${event.timestamp}:${index}`,
          ruleId: rule.id,
          matchedKeyword,
          promptSource: promptSourceFor(event),
          asset: rule.asset,
          durationMs: rule.durationMs
        }
      }
    ];
  });
}

function rawRuleList(input: unknown): unknown[] | undefined {
  if (Array.isArray(input)) return input;
  if (isRecord(input) && Array.isArray(input.rules)) return input.rules;
  return undefined;
}

function normalizeRule(input: unknown, projectRoot: string): StickerRule | undefined {
  if (!isRecord(input)) return undefined;
  if (input.enabled === false) return undefined;

  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id) return undefined;

  const keywords = Array.isArray(input.keywords)
    ? input.keywords.flatMap((keyword) => {
        if (typeof keyword !== "string") return [];
        const trimmed = keyword.trim();
        return trimmed ? [trimmed] : [];
      })
    : [];
  if (keywords.length === 0) return undefined;

  const asset = normalizeAsset(input.asset, projectRoot);
  if (!asset) return undefined;

  return {
    id,
    keywords,
    asset,
    durationMs: clampDuration(input.durationMs)
  };
}

function normalizeAsset(input: unknown, projectRoot: string): StickerAsset | undefined {
  if (!isRecord(input) || typeof input.type !== "string") return undefined;

  if (input.type === "emoji") {
    const value = typeof input.value === "string" ? input.value.trim() : "";
    return value ? { type: "emoji", value } : undefined;
  }

  if (!isPathAssetType(input.type)) return undefined;

  const rawPath = typeof input.path === "string" ? input.path.trim() : "";
  if (!rawPath) return undefined;

  const resolvedPath = isAbsolute(rawPath) ? rawPath : resolve(projectRoot, rawPath);
  return {
    type: input.type,
    path: resolvedPath,
    url: pathToFileURL(resolvedPath).toString()
  };
}

function clampDuration(value: unknown): number {
  const duration = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : defaultStickerRule.durationMs;
  return Math.min(5000, Math.max(1, duration));
}

function promptSourceFor(event: ContextEvent): unknown {
  if (isRecord(event.metadata) && typeof event.metadata.promptSource === "string") {
    return event.metadata.promptSource;
  }
  return event.source;
}

function isPathAssetType(value: string): value is "image" | "gif" | "video" {
  return value === "image" || value === "gif" || value === "video";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
