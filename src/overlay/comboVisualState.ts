export interface ComboVisualStateInput {
  count: number;
  elapsedMs: number;
  comboWindowMs: number;
}

export interface ComboVisualState {
  visible: boolean;
  opacity: number;
  progress: number;
}

export function comboVisualState(input: ComboVisualStateInput): ComboVisualState {
  if (input.count <= 0 || input.elapsedMs > input.comboWindowMs) {
    return { visible: false, opacity: 0, progress: 1 };
  }

  const progress = clamp(input.elapsedMs / input.comboWindowMs);
  return {
    visible: true,
    opacity: round(1 - progress),
    progress: round(progress)
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
