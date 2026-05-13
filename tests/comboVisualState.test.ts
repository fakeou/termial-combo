import { describe, expect, it } from "vitest";
import { comboVisualState } from "../src/overlay/comboVisualState.js";

describe("comboVisualState", () => {
  it("is hidden when count is zero", () => {
    expect(comboVisualState({ count: 0, elapsedMs: 0, comboWindowMs: 2000 })).toEqual({
      visible: false,
      opacity: 0,
      progress: 1
    });
  });

  it("fades while the combo window elapses", () => {
    expect(comboVisualState({ count: 4, elapsedMs: 0, comboWindowMs: 2000 })).toEqual({
      visible: true,
      opacity: 1,
      progress: 0
    });
    expect(comboVisualState({ count: 4, elapsedMs: 1000, comboWindowMs: 2000 })).toEqual({
      visible: true,
      opacity: 0.5,
      progress: 0.5
    });
  });

  it("is hidden after the combo window expires", () => {
    expect(comboVisualState({ count: 4, elapsedMs: 2001, comboWindowMs: 2000 })).toEqual({
      visible: false,
      opacity: 0,
      progress: 1
    });
  });
});
