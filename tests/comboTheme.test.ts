import { describe, expect, it } from "vitest";
import { comboThemeForCount } from "../src/overlay/comboTheme.js";

describe("comboThemeForCount", () => {
  it("returns low-count blue styling and C rank", () => {
    expect(comboThemeForCount(1)).toMatchObject({
      className: "theme-blue",
      rank: "C"
    });
  });

  it("progresses through stronger ranks and colors before 100", () => {
    expect(comboThemeForCount(12)).toMatchObject({ className: "theme-violet", rank: "B" });
    expect(comboThemeForCount(35)).toMatchObject({ className: "theme-crimson", rank: "A" });
    expect(comboThemeForCount(70)).toMatchObject({ className: "theme-inferno", rank: "SS" });
  });

  it("locks 100+ combo to gold and SSS", () => {
    expect(comboThemeForCount(100)).toMatchObject({
      className: "theme-gold",
      rank: "SSS"
    });
    expect(comboThemeForCount(999)).toMatchObject({
      className: "theme-gold",
      rank: "SSS"
    });
  });
});
