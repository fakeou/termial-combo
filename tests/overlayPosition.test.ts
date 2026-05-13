import { describe, expect, it } from "vitest";
import { computeOverlayBounds } from "../src/overlay/position.js";

describe("computeOverlayBounds", () => {
  it("places the overlay near the active window top-right corner", () => {
    expect(
      computeOverlayBounds(
        { x: 0, y: 37, width: 1470, height: 919 },
        { width: 72, height: 72, margin: 12 }
      )
    ).toEqual({ x: 1386, y: 49, width: 72, height: 72 });
  });

  it("supports windows on displays with negative coordinates", () => {
    expect(
      computeOverlayBounds(
        { x: -2568, y: -454, width: 2560, height: 1365 },
        { width: 72, height: 72, margin: 12 }
      )
    ).toEqual({ x: -92, y: -442, width: 72, height: 72 });
  });
});
