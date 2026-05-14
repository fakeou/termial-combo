export interface StickerTiming {
  visibleMs: number;
  exitMs: number;
}

const maxExitMs = 420;

export function stickerTimingForDuration(durationMs: number): StickerTiming {
  const normalizedDurationMs = Math.max(1, Math.trunc(durationMs));
  const exitMs = Math.min(maxExitMs, Math.floor(normalizedDurationMs / 2));
  return {
    visibleMs: normalizedDurationMs - exitMs,
    exitMs
  };
}
