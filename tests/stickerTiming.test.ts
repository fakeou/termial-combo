import { describe, expect, it } from "vitest";
import { stickerTimingForDuration } from "../src/overlay/stickerTiming.js";

describe("stickerTimingForDuration", () => {
  it("keeps fade-out inside the configured sticker duration", () => {
    expect(stickerTimingForDuration(2000)).toEqual({
      visibleMs: 1580,
      exitMs: 420
    });
  });

  it("shortens fade-out for very short sticker durations", () => {
    expect(stickerTimingForDuration(250)).toEqual({
      visibleMs: 125,
      exitMs: 125
    });
  });
});
