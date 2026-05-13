import { describe, expect, it } from "vitest";
import { isWarpWindow, toWindowEvents } from "../src/windowDetector.js";

describe("window detector helpers", () => {
  it("recognizes Warp by app name or bundle id", () => {
    expect(isWarpWindow({ appName: "Warp", bundleId: "dev.warp.Warp-Stable" })).toBe(true);
    expect(isWarpWindow({ appName: "Warp Preview", bundleId: "dev.warp.Warp-Preview" })).toBe(true);
    expect(isWarpWindow({ appName: "Terminal", bundleId: "com.apple.Terminal" })).toBe(false);
  });

  it("creates app, window, and Warp events when focus changes to Warp", () => {
    const events = toWindowEvents(
      undefined,
      {
        appName: "Warp",
        bundleId: "dev.warp.Warp-Stable",
        pid: 123,
        title: "repo",
        bounds: { x: 10, y: 20, width: 900, height: 600 }
      },
      "active-win"
    );

    expect(events.map((event) => event.type)).toEqual([
      "active_app_changed",
      "active_window_changed",
      "warp_window_detected"
    ]);
    expect(events[2].metadata).toMatchObject({ title: "repo", bounds: { x: 10, y: 20, width: 900, height: 600 } });
  });
});
