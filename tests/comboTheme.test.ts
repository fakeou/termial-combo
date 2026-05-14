import { describe, expect, it } from "vitest";
import { comboThemeForCount } from "../src/overlay/comboTheme.js";

describe("comboThemeForCount", () => {
  it("returns ash styling and C rank for low counts", () => {
    expect(comboThemeForCount(1)).toMatchObject({
      className: "theme-ash",
      rank: "C"
    });
  });

  it("progresses through stronger ranks and colors", () => {
    expect(comboThemeForCount(10)).toMatchObject({ className: "theme-blue", rank: "B" });
    expect(comboThemeForCount(20)).toMatchObject({ className: "theme-violet", rank: "A" });
    expect(comboThemeForCount(30)).toMatchObject({ className: "theme-crimson", rank: "S" });
    expect(comboThemeForCount(40)).toMatchObject({ className: "theme-inferno", rank: "SS" });
    expect(comboThemeForCount(50)).toMatchObject({ className: "theme-gold", rank: "SSS" });
  });

  it("keeps SSS for very high counts", () => {
    expect(comboThemeForCount(100)).toMatchObject({ className: "theme-gold", rank: "SSS" });
  });
});
