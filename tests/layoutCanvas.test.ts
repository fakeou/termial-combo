import { describe, expect, it } from "vitest";
import { canvasRectToLayout, layoutToCanvasRect, presetStickerLayout } from "../src/overlay/layoutCanvas.js";

describe("layout canvas helpers", () => {
  it("converts normalized sticker layout to canvas pixels", () => {
    expect(
      layoutToCanvasRect(
        { x: 0.25, y: 0.1, width: 0.5, height: 0.4, opacity: 1, fit: "contain" },
        { width: 1000, height: 600 }
      )
    ).toEqual({ x: 250, y: 60, width: 500, height: 240 });
  });

  it("converts dragged canvas pixels back to normalized sticker layout", () => {
    expect(
      canvasRectToLayout(
        { x: 120, y: 40, width: 360, height: 280 },
        { width: 1200, height: 800 },
        { opacity: 0.8, fit: "cover" }
      )
    ).toEqual({ x: 0.1, y: 0.05, width: 0.3, height: 0.35, opacity: 0.8, fit: "cover" });
  });

  it("provides useful preset positions", () => {
    expect(presetStickerLayout("fill")).toEqual({ x: 0, y: 0, width: 1, height: 1, opacity: 1, fit: "cover" });
    expect(presetStickerLayout("top-right")).toEqual({ x: 0.66, y: 0.08, width: 0.28, height: 0.24, opacity: 1, fit: "contain" });
  });
});
