import { describe, expect, it } from "vitest";
import { ComboCounter } from "../src/overlay/comboCounter.js";

describe("ComboCounter", () => {
  it("increments while activity continues within the combo window", () => {
    const counter = new ComboCounter({ comboWindowMs: 2000 });

    expect(counter.recordActivity(1000)).toBe(1);
    expect(counter.recordActivity(2000)).toBe(2);
    expect(counter.recordActivity(3999)).toBe(3);
  });

  it("starts a new combo after the window expires", () => {
    const counter = new ComboCounter({ comboWindowMs: 2000 });

    expect(counter.recordActivity(1000)).toBe(1);
    expect(counter.recordActivity(3001)).toBe(1);
  });

  it("reports zero after inactivity", () => {
    const counter = new ComboCounter({ comboWindowMs: 2000 });

    counter.recordActivity(1000);

    expect(counter.valueAt(2999)).toBe(1);
    expect(counter.valueAt(3001)).toBe(0);
  });
});
