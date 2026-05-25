export interface ComboStagePosition {
  left: number;
  top: number;
}

export function comboStageStyle(
  opacity: number,
  position?: ComboStagePosition
): { opacity: number; left?: string; top?: string } {
  if (!position) return { opacity };

  return {
    opacity,
    left: `${Math.round(position.left)}px`,
    top: `${Math.round(position.top)}px`
  };
}
