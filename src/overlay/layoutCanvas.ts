import { clampStickerLayout, defaultStickerLayout, StickerLayout, StickerLayoutFit } from "../stickerLayout.js";

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type StickerLayoutPreset = "fill" | "center" | "top-right" | "reset";

export function layoutToCanvasRect(layout: StickerLayout, canvas: CanvasSize): CanvasRect {
  const safeLayout = clampStickerLayout(layout);
  return {
    x: Math.round(safeLayout.x * canvas.width),
    y: Math.round(safeLayout.y * canvas.height),
    width: Math.round(safeLayout.width * canvas.width),
    height: Math.round(safeLayout.height * canvas.height)
  };
}

export function canvasRectToLayout(
  rect: CanvasRect,
  canvas: CanvasSize,
  options: { opacity: number; fit: StickerLayoutFit }
): StickerLayout {
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  return clampStickerLayout({
    x: rect.x / width,
    y: rect.y / height,
    width: rect.width / width,
    height: rect.height / height,
    opacity: options.opacity,
    fit: options.fit
  });
}

export function presetStickerLayout(preset: StickerLayoutPreset): StickerLayout {
  if (preset === "fill") {
    return { x: 0, y: 0, width: 1, height: 1, opacity: 1, fit: "cover" };
  }
  if (preset === "center") {
    return { x: 0.25, y: 0.25, width: 0.5, height: 0.5, opacity: 1, fit: "contain" };
  }
  if (preset === "top-right") {
    return { x: 0.66, y: 0.08, width: 0.28, height: 0.24, opacity: 1, fit: "contain" };
  }
  return defaultStickerLayout;
}
