export interface ComboTheme {
  className: string;
  rank: "C" | "B" | "A" | "S" | "SS" | "SSS";
}

export function comboThemeForCount(count: number): ComboTheme {
  if (count >= 100) return { className: "theme-gold", rank: "SSS" };
  if (count >= 60) return { className: "theme-inferno", rank: "SS" };
  if (count >= 30) return { className: "theme-crimson", rank: "A" };
  if (count >= 10) return { className: "theme-violet", rank: "B" };
  return { className: "theme-blue", rank: "C" };
}
