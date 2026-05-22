import { Bounds } from "./types.js";

export type StickerLayoutFit = "contain" | "cover" | "fill";

export interface StickerLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  fit: StickerLayoutFit;
}

export const defaultStickerLayout: StickerLayout = {
  x: 0.34,
  y: 0.64,
  width: 0.28,
  height: 0.24,
  opacity: 1,
  fit: "contain"
};

export function clampStickerLayout(input: unknown): StickerLayout {
  if (!isRecord(input)) return defaultStickerLayout;

  return {
    x: clampNumber(input.x, 0, 1, defaultStickerLayout.x),
    y: clampNumber(input.y, 0, 1, defaultStickerLayout.y),
    width: clampNumber(input.width, 0.05, 1, defaultStickerLayout.width),
    height: clampNumber(input.height, 0.05, 1, defaultStickerLayout.height),
    opacity: clampNumber(input.opacity, 0, 1, defaultStickerLayout.opacity),
    fit: input.fit === "cover" || input.fit === "fill" || input.fit === "contain" ? input.fit : defaultStickerLayout.fit
  };
}

export function fullWarpOverlayBounds(bounds: Bounds): Bounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
