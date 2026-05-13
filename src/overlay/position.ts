import { Bounds } from "../types.js";

export interface OverlayPositionOptions {
  width: number;
  height: number;
  margin: number;
}

export function computeOverlayBounds(windowBounds: Bounds, options: OverlayPositionOptions): Bounds {
  return {
    x: Math.round(windowBounds.x + windowBounds.width - options.width - options.margin),
    y: Math.round(windowBounds.y + options.margin),
    width: options.width,
    height: options.height
  };
}
