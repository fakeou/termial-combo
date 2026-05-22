import { describe, expect, it } from "vitest";
import { clampStickerLayout, defaultStickerLayout, fullWarpOverlayBounds } from "../src/stickerLayout.js";

describe("sticker layout", () => {
  it("normalizes layout values into a safe 0..1 canvas coordinate system", () => {
    expect(
      clampStickerLayout({
        x: -0.2,
        y: 1.4,
        width: 2,
        height: 0,
        opacity: 2,
        fit: "cover"
      })
    ).toEqual({
      x: 0,
      y: 1,
      width: 1,
      height: 0.05,
      opacity: 1,
      fit: "cover"
    });
  });

  it("uses a centered sticker layout by default", () => {
    expect(clampStickerLayout(undefined)).toEqual(defaultStickerLayout);
  });

  it("computes full Warp overlay bounds without the small combo margin", () => {
    expect(fullWarpOverlayBounds({ x: 10, y: 20, width: 1200, height: 800 })).toEqual({
      x: 10,
      y: 20,
      width: 1200,
      height: 800
    });
  });
});
