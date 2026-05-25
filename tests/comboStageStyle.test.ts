import { describe, expect, it } from "vitest";
import { comboStageStyle } from "../src/overlay/comboStageStyle.js";

describe("comboStageStyle", () => {
  it("uses the compact overlay center when the full Warp overlay provides one", () => {
    expect(comboStageStyle(0.82, { left: 1024, top: 156 })).toEqual({
      opacity: 0.82,
      left: "1024px",
      top: "156px"
    });
  });

  it("falls back to stylesheet centering in compact overlay mode", () => {
    expect(comboStageStyle(1)).toEqual({ opacity: 1 });
  });
});
