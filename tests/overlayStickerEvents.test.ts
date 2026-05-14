import { describe, expect, it } from "vitest";
import { extractNewStickerCommands } from "../src/overlay/stickerEvents.js";
import { ContextEvent } from "../src/types.js";

function event(metadata: Record<string, unknown>, type: ContextEvent["type"] = "sticker_triggered"): ContextEvent {
  return {
    type,
    source: "sticker-rules",
    timestamp: "2026-05-14T01:02:03.000Z",
    metadata
  };
}

describe("extractNewStickerCommands", () => {
  it("extracts valid sticker trigger events and deduplicates by trigger id", () => {
    const seenTriggerIds = new Set<string>(["seen"]);
    const events = [
      event({
        triggerId: "seen",
        asset: { type: "emoji", value: "old" },
        durationMs: 1000
      }),
      event({
        triggerId: "emoji-1",
        asset: { type: "emoji", value: "😵" },
        durationMs: 1500,
        matchedKeyword: "不对",
        ruleId: "retry"
      }),
      event({
        triggerId: "image-1",
        asset: { type: "image", path: "/tmp/sticker.png", url: "file:///tmp/sticker.png" }
      }),
      event({
        triggerId: "emoji-1",
        asset: { type: "emoji", value: "duplicate" },
        durationMs: 2000
      })
    ];

    expect(extractNewStickerCommands(events, seenTriggerIds)).toEqual([
      {
        triggerId: "emoji-1",
        asset: { type: "emoji", value: "😵" },
        durationMs: 1500,
        matchedKeyword: "不对",
        ruleId: "retry"
      },
      {
        triggerId: "image-1",
        asset: { type: "image", url: "file:///tmp/sticker.png" },
        durationMs: 2000
      }
    ]);
    expect([...seenTriggerIds].sort()).toEqual(["emoji-1", "image-1", "seen"]);
  });

  it("ignores non-sticker and malformed sticker events", () => {
    const seenTriggerIds = new Set<string>();
    const malformedEvents = [
      event({ triggerId: "wrong-type", asset: { type: "emoji", value: "x" } }, "ai_prompt_submitted"),
      event({ asset: { type: "emoji", value: "x" } }),
      event({ triggerId: "", asset: { type: "emoji", value: "x" } }),
      event({ triggerId: "empty-emoji", asset: { type: "emoji", value: "" } }),
      event({ triggerId: "blank-emoji", asset: { type: "emoji", value: "   " } }),
      event({ triggerId: "missing-url", asset: { type: "gif", path: "/tmp/a.gif" } }),
      event({ triggerId: "blank-url", asset: { type: "video", url: "   " } }),
      event({ triggerId: "unsupported", asset: { type: "audio", url: "file:///tmp/a.mp3" } }),
      event({ triggerId: "missing-asset" })
    ];

    expect(extractNewStickerCommands(malformedEvents, seenTriggerIds)).toEqual([]);
    expect(seenTriggerIds.size).toBe(0);
  });

  it("clamps duration to 1..5000 and defaults to 2000", () => {
    const seenTriggerIds = new Set<string>();
    const events = [
      event({ triggerId: "min", asset: { type: "emoji", value: "x" }, durationMs: -10 }),
      event({ triggerId: "max", asset: { type: "gif", url: "file:///tmp/a.gif" }, durationMs: 9000 }),
      event({ triggerId: "trunc", asset: { type: "video", url: "file:///tmp/a.mp4" }, durationMs: 1200.9 }),
      event({ triggerId: "default", asset: { type: "image", url: "file:///tmp/a.png" }, durationMs: "slow" })
    ];

    expect(extractNewStickerCommands(events, seenTriggerIds).map((command) => command.durationMs)).toEqual([
      1,
      5000,
      1200,
      2000
    ]);
  });
});
