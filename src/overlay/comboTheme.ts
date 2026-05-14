export interface ComboTheme {
  className: string;
  rank: "C" | "B" | "A" | "S" | "SS" | "SSS";
}

export function comboThemeForCount(count: number): ComboTheme {
  if (count >= 50) return { className: "theme-gold", rank: "SSS" };
  if (count >= 40) return { className: "theme-inferno", rank: "SS" };
  if (count >= 30) return { className: "theme-crimson", rank: "S" };
  if (count >= 20) return { className: "theme-violet", rank: "A" };
  if (count >= 10) return { className: "theme-blue", rank: "B" };
  return { className: "theme-ash", rank: "C" };
}
