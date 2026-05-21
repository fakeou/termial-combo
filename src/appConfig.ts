import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { defaultStickerRule, normalizeStickerRules, StickerRule } from "./stickerRules.js";

export type ComboStyleId = "arcade" | "neon" | "gold" | "custom";
export type ComboBackgroundStyle = "none" | "speed-lines" | "sparks" | "burst";
export type ComboEnterAnimation = "pop" | "slide" | "fade";
export type ComboHitAnimation = "shake" | "pulse" | "none";
export type ComboExitAnimation = "fade" | "scale";

export interface ComboDesignConfig {
  style: ComboStyleId;
  comboWindowMs: number;
  counter: {
    label: string;
    subLabel: string;
    numberColor: string;
    textColor: string;
    accentColor: string;
    fontSize: number;
    scale: number;
    skewDeg: number;
  };
  background: {
    enabled: boolean;
    style: ComboBackgroundStyle;
    opacity: number;
  };
  animation: {
    enter: ComboEnterAnimation;
    hit: ComboHitAnimation;
    exit: ComboExitAnimation;
    fadeOutMs: number;
  };
}

export interface AppConfig {
  combo: ComboDesignConfig;
  rules: StickerRule[];
}

export const defaultComboConfig: ComboDesignConfig = {
  style: "arcade",
  comboWindowMs: 2000,
  counter: {
    label: "COMBO",
    subLabel: "HIT",
    numberColor: "#f4fdff",
    textColor: "#9ee8ff",
    accentColor: "#36b6ff",
    fontSize: 58,
    scale: 1,
    skewDeg: -8
  },
  background: {
    enabled: true,
    style: "speed-lines",
    opacity: 1
  },
  animation: {
    enter: "pop",
    hit: "shake",
    exit: "fade",
    fadeOutMs: 420
  }
};

export const defaultAppConfig: AppConfig = {
  combo: defaultComboConfig,
  rules: [defaultStickerRule]
};

export interface LoadAppConfigOptions {
  configPath: string;
  projectRoot: string;
}

export async function loadAppConfig(options: LoadAppConfigOptions): Promise<AppConfig> {
  try {
    const raw = await readFile(options.configPath, "utf8");
    return normalizeAppConfig(JSON.parse(raw), options.projectRoot);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return defaultAppConfig;
    }
    throw error;
  }
}

export interface SaveAppConfigOptions extends LoadAppConfigOptions {
  input: unknown;
}

export async function saveAppConfig(options: SaveAppConfigOptions): Promise<AppConfig> {
  const config = normalizeAppConfig(options.input, options.projectRoot);
  await mkdir(dirname(options.configPath), { recursive: true });
  await writeFile(options.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

export function normalizeAppConfig(input: unknown, projectRoot: string): AppConfig {
  const record = isRecord(input) ? input : {};
  const combo = normalizeComboConfig(record.combo);
  const rules = normalizeStickerRules(record.rules ? { rules: record.rules } : input, projectRoot);
  return { combo, rules };
}

function normalizeComboConfig(input: unknown): ComboDesignConfig {
  if (!isRecord(input)) return defaultComboConfig;

  return {
    style: enumValue(input.style, ["arcade", "neon", "gold", "custom"], defaultComboConfig.style),
    comboWindowMs: clampNumber(input.comboWindowMs, 500, 5000, defaultComboConfig.comboWindowMs),
    counter: normalizeCounter(input.counter),
    background: normalizeBackground(input.background),
    animation: normalizeAnimation(input.animation)
  };
}

function normalizeCounter(input: unknown): ComboDesignConfig["counter"] {
  const record = isRecord(input) ? input : {};
  return {
    label: shortText(record.label, defaultComboConfig.counter.label, 12),
    subLabel: shortText(record.subLabel, defaultComboConfig.counter.subLabel, 10),
    numberColor: colorValue(record.numberColor, defaultComboConfig.counter.numberColor),
    textColor: colorValue(record.textColor, defaultComboConfig.counter.textColor),
    accentColor: colorValue(record.accentColor, defaultComboConfig.counter.accentColor),
    fontSize: clampNumber(record.fontSize, 32, 72, defaultComboConfig.counter.fontSize),
    scale: clampNumber(record.scale, 0.7, 1.5, defaultComboConfig.counter.scale),
    skewDeg: clampNumber(record.skewDeg, -24, 12, defaultComboConfig.counter.skewDeg)
  };
}

function normalizeBackground(input: unknown): ComboDesignConfig["background"] {
  const record = isRecord(input) ? input : {};
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : defaultComboConfig.background.enabled,
    style: enumValue(record.style, ["none", "speed-lines", "sparks", "burst"], defaultComboConfig.background.style),
    opacity: clampNumber(record.opacity, 0, 1, defaultComboConfig.background.opacity)
  };
}

function normalizeAnimation(input: unknown): ComboDesignConfig["animation"] {
  const record = isRecord(input) ? input : {};
  return {
    enter: enumValue(record.enter, ["pop", "slide", "fade"], defaultComboConfig.animation.enter),
    hit: enumValue(record.hit, ["shake", "pulse", "none"], defaultComboConfig.animation.hit),
    exit: enumValue(record.exit, ["fade", "scale"], defaultComboConfig.animation.exit),
    fadeOutMs: clampNumber(record.fadeOutMs, 120, 2000, defaultComboConfig.animation.fadeOutMs)
  };
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function shortText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function colorValue(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
