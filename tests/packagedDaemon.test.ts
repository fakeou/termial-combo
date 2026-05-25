import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildPackagedDaemonSpawnEnv,
  comboStagePositionWithinFullWarp,
  comboTriggerIdFromPromptEvent,
  extractNewStickerCommands,
  fullWarpOverlayBounds,
  hasRecentLayoutStickerGrace,
  hasRecentStickerGrace,
  hasUsableWarpBounds
} = require("../src/electron/packagedDaemon.cjs") as {
  buildPackagedDaemonSpawnEnv: (options: {
    baseEnv: NodeJS.ProcessEnv;
    eventLogPath: string;
    stickerRulesPath: string;
  }) => NodeJS.ProcessEnv;
  comboStagePositionWithinFullWarp: (
    bounds: { x: number; y: number; width: number; height: number },
    options: { width: number; height: number; margin: number }
  ) => { left: number; top: number };
  comboTriggerIdFromPromptEvent: (event: unknown) => string | undefined;
  extractNewStickerCommands: (events: unknown[], seenTriggerIds: Set<string>) => Array<Record<string, unknown>>;
  fullWarpOverlayBounds: (bounds: { x: number; y: number; width: number; height: number }) => { x: number; y: number; width: number; height: number };
  hasRecentLayoutStickerGrace: (options: { now: number; layoutStickerUntil: number; hasLastUsableWarpWindow: boolean }) => boolean;
  hasRecentStickerGrace: (options: { now: number; lastStickerAt: number; graceMs: number; hasLastUsableWarpWindow: boolean }) => boolean;
  hasUsableWarpBounds: (bounds: unknown) => boolean;
};

describe("buildPackagedDaemonSpawnEnv", () => {
  it("runs the packaged daemon under Electron's Node mode", () => {
    expect(
      buildPackagedDaemonSpawnEnv({
        baseEnv: {},
        eventLogPath: "/app/logs/events.jsonl",
        stickerRulesPath: "/app/config/sticker-rules.json"
      })
    ).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      EVENT_LOG_PATH: "/app/logs/events.jsonl",
      STICKER_RULES_PATH: "/app/config/sticker-rules.json",
      APP_CONFIG_PATH: "/app/config/sticker-rules.json"
    });
  });

  it("preserves explicit log and rule paths", () => {
    expect(
      buildPackagedDaemonSpawnEnv({
        baseEnv: {
          EVENT_LOG_PATH: "/custom/events.jsonl",
          STICKER_RULES_PATH: "/custom/sticker-rules.json",
          APP_CONFIG_PATH: "/custom/combo-config.json"
        },
        eventLogPath: "/app/logs/events.jsonl",
        stickerRulesPath: "/app/config/sticker-rules.json"
      })
    ).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      EVENT_LOG_PATH: "/custom/events.jsonl",
      STICKER_RULES_PATH: "/custom/sticker-rules.json",
      APP_CONFIG_PATH: "/custom/combo-config.json"
    });
  });
});

describe("hasUsableWarpBounds", () => {
  it("rejects tiny Warp utility bounds", () => {
    expect(hasUsableWarpBounds({ x: 240, y: 647, width: 84, height: 77 })).toBe(false);
    expect(hasUsableWarpBounds({ x: 0, y: 37, width: 1470, height: 919 })).toBe(true);
  });
});

describe("comboTriggerIdFromPromptEvent", () => {
  it("creates stable combo trigger ids for Codex and Claude prompt events", () => {
    expect(
      comboTriggerIdFromPromptEvent({
        type: "ai_prompt_submitted",
        source: "codex-cli",
        timestamp: "2026-05-18T10:50:51.000Z",
        sessionId: "s1",
        text: "现在还是没有连击特效啊"
      })
    ).toBe("codex-cli\u001f2026-05-18T10:50:51.000Z\u001fs1\u001f现在还是没有连击特效啊");

    expect(
      comboTriggerIdFromPromptEvent({
        type: "ai_prompt_submitted",
        source: "claude-code",
        timestamp: "2026-05-18T10:50:52.000Z",
        text: "不对"
      })
    ).toBe("claude-code\u001f2026-05-18T10:50:52.000Z\u001f\u001f不对");
  });

  it("ignores non-prompt or unsupported prompt events", () => {
    expect(comboTriggerIdFromPromptEvent({ type: "warp_window_detected", source: "active-win" })).toBeUndefined();
    expect(comboTriggerIdFromPromptEvent({ type: "ai_prompt_submitted", source: "test-script", text: "x" })).toBeUndefined();
  });
});

describe("hasRecentStickerGrace", () => {
  it("keeps the overlay available briefly after sticker triggers when a usable Warp window is known", () => {
    expect(
      hasRecentStickerGrace({
        now: 10_900,
        lastStickerAt: 10_000,
        graceMs: 5_000,
        hasLastUsableWarpWindow: true
      })
    ).toBe(true);
  });

  it("does not keep the overlay without a recent sticker or known Warp window", () => {
    expect(
      hasRecentStickerGrace({
        now: 16_000,
        lastStickerAt: 10_000,
        graceMs: 5_000,
        hasLastUsableWarpWindow: true
      })
    ).toBe(false);
    expect(
      hasRecentStickerGrace({
        now: 10_900,
        lastStickerAt: 10_000,
        graceMs: 5_000,
        hasLastUsableWarpWindow: false
      })
    ).toBe(false);
  });
});

describe("layout sticker overlay bounds", () => {
  it("uses the full Warp window bounds for canvas-positioned stickers", () => {
    expect(fullWarpOverlayBounds({ x: 10.4, y: 20.5, width: 1199.6, height: 799.2 })).toEqual({
      x: 10,
      y: 21,
      width: 1200,
      height: 799
    });
  });

  it("keeps the combo stage at the compact overlay center when a layout sticker expands the overlay", () => {
    expect(
      comboStagePositionWithinFullWarp(
        { x: 10, y: 20, width: 1200, height: 800 },
        { width: 360, height: 320, margin: -4 }
      )
    ).toEqual({ left: 1024, top: 156 });
  });

  it("keeps full-window overlay mode only while a layout sticker is active", () => {
    expect(
      hasRecentLayoutStickerGrace({
        now: 12_000,
        layoutStickerUntil: 13_000,
        hasLastUsableWarpWindow: true
      })
    ).toBe(true);
    expect(
      hasRecentLayoutStickerGrace({
        now: 13_001,
        layoutStickerUntil: 13_000,
        hasLastUsableWarpWindow: true
      })
    ).toBe(false);
    expect(
      hasRecentLayoutStickerGrace({
        now: 12_000,
        layoutStickerUntil: 13_000,
        hasLastUsableWarpWindow: false
      })
    ).toBe(false);
  });
});

describe("extractNewStickerCommands", () => {
  it("keeps cycle assets and layout metadata for Electron renderer commands", () => {
    expect(
      extractNewStickerCommands(
        [
          {
            type: "sticker_triggered",
            metadata: {
              triggerId: "cycle",
              asset: { type: "emoji", value: "😵" },
              assets: [
                { type: "emoji", value: "😵" },
                { type: "image", url: "file:///tmp/no.png" }
              ],
              displayMode: "cycle",
              cycleIntervalMs: 600,
              durationMs: 3_000,
              layout: { x: 0, y: 0.2, width: 1, height: 0.6, opacity: 0.75, fit: "cover" },
              matchedKeyword: "不对",
              ruleId: "bad"
            }
          }
        ],
        new Set()
      )
    ).toEqual([
      {
        triggerId: "cycle",
        asset: { type: "emoji", value: "😵" },
        assets: [
          { type: "emoji", value: "😵" },
          { type: "image", url: "file:///tmp/no.png" }
        ],
        displayMode: "cycle",
        cycleIntervalMs: 600,
        durationMs: 3_000,
        layout: { x: 0, y: 0.2, width: 1, height: 0.6, opacity: 0.75, fit: "cover" },
        matchedKeyword: "不对",
        ruleId: "bad"
      }
    ]);
  });
});
