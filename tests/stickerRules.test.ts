import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildStickerTriggerEvents,
  defaultStickerRule,
  loadStickerRules,
  normalizeStickerRules
} from "../src/stickerRules.js";
import { ContextEvent } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs.length = 0;
});

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sticker-rules-"));
  tempDirs.push(dir);
  return dir;
}

describe("sticker rules", () => {
  it("falls back to the default rule when config is missing", async () => {
    const projectRoot = await tempProject();

    await expect(loadStickerRules({ configPath: join(projectRoot, "missing.json"), projectRoot })).resolves.toEqual([
      defaultStickerRule
    ]);
  });

  it("validates rules, drops invalid entries, clamps max duration, and resolves file URLs", () => {
    const projectRoot = "/tmp/project";
    const rules = normalizeStickerRules(
      [
        {
          id: " retry ",
          keywords: ["", " 不对 ", 42, "不行"],
          asset: { type: "image", path: "stickers/retry.png" },
          durationMs: 9000
        },
        { id: "disabled", enabled: false, keywords: ["no"], asset: { type: "emoji", value: "x" } },
        { id: "empty-id", keywords: ["no"], asset: { type: "emoji", value: "" } },
        { id: "", keywords: ["no"], asset: { type: "emoji", value: "x" } },
        { id: "empty-keywords", keywords: ["", "  "], asset: { type: "emoji", value: "x" } },
        { id: "invalid-asset", keywords: ["no"], asset: { type: "audio", path: "no.mp3" } }
      ],
      projectRoot
    );

    expect(rules).toEqual([
      {
        id: "retry",
        keywords: ["不对", "不行"],
        asset: {
          type: "image",
          path: join(projectRoot, "stickers/retry.png"),
          url: pathToFileURL(join(projectRoot, "stickers/retry.png")).toString()
        },
        assets: [
          {
            type: "image",
            path: join(projectRoot, "stickers/retry.png"),
            url: pathToFileURL(join(projectRoot, "stickers/retry.png")).toString()
          }
        ],
        displayMode: "single",
        cycleIntervalMs: 750,
        durationMs: 5000
      }
    ]);
  });

  it("returns the default rule when config shape is invalid or all rules are invalid", () => {
    expect(normalizeStickerRules({ rules: [] }, "/tmp/project")).toEqual([defaultStickerRule]);
    expect(normalizeStickerRules([{ id: "", keywords: [], asset: { type: "emoji", value: "" } }], "/tmp/project")).toEqual([
      defaultStickerRule
    ]);
  });

  it("clamps minimum duration", () => {
    const rules = normalizeStickerRules(
      [{ id: "fast", keywords: ["retry"], asset: { type: "emoji", value: "😵" }, durationMs: -10 }],
      "/tmp/project"
    );

    expect(rules[0]).toMatchObject({ id: "fast", durationMs: 1 });
  });

  it("creates sticker trigger events for matching prompt rules", () => {
    const event: ContextEvent = {
      type: "ai_prompt_submitted",
      source: "claude-code",
      timestamp: "2026-05-14T01:02:03.000Z",
      cwd: "/repo",
      sessionId: "session-1",
      text: "这里不对，重新来",
      metadata: { promptSource: "user" }
    };
    const rules = [
      { id: "retry", keywords: ["不对", "重新来"], asset: { type: "emoji" as const, value: "😵" }, durationMs: 2000 },
      { id: "again", keywords: ["重新来"], asset: { type: "gif" as const, path: "/tmp/retry.gif", url: "file:///tmp/retry.gif" }, durationMs: 1000 },
      { id: "miss", keywords: ["nope"], asset: { type: "emoji" as const, value: "x" }, durationMs: 1000 }
    ];

    expect(buildStickerTriggerEvents(event, rules)).toEqual([
      {
        type: "sticker_triggered",
        source: "sticker-rules",
        cwd: "/repo",
        sessionId: "session-1",
        text: "这里不对，重新来",
        metadata: {
          triggerId: "retry:2026-05-14T01:02:03.000Z:0",
          ruleId: "retry",
          matchedKeyword: "不对",
          promptSource: "user",
          asset: { type: "emoji", value: "😵" },
          assets: [{ type: "emoji", value: "😵" }],
          displayMode: "single",
          cycleIntervalMs: 750,
          durationMs: 2000
        }
      },
      {
        type: "sticker_triggered",
        source: "sticker-rules",
        cwd: "/repo",
        sessionId: "session-1",
        text: "这里不对，重新来",
        metadata: {
          triggerId: "again:2026-05-14T01:02:03.000Z:1",
          ruleId: "again",
          matchedKeyword: "重新来",
          promptSource: "user",
          asset: { type: "gif", path: "/tmp/retry.gif", url: "file:///tmp/retry.gif" },
          assets: [{ type: "gif", path: "/tmp/retry.gif", url: "file:///tmp/retry.gif" }],
          displayMode: "single",
          cycleIntervalMs: 750,
          durationMs: 1000
        }
      }
    ]);
  });

  it("creates cycle trigger events with all configured assets", () => {
    const event: ContextEvent = {
      type: "ai_prompt_submitted",
      source: "codex-cli",
      timestamp: "2026-05-14T01:02:03.000Z",
      text: "这里卡住了"
    };
    const rules = [
      {
        id: "stuck-cycle",
        keywords: ["卡住"],
        asset: { type: "emoji" as const, value: "😵" },
        assets: [
          { type: "emoji" as const, value: "😵" },
          { type: "gif" as const, path: "/tmp/stuck.gif", url: "file:///tmp/stuck.gif" }
        ],
        displayMode: "cycle" as const,
        layout: { x: 0, y: 0, width: 1, height: 1, opacity: 0.75, fit: "cover" as const },
        cycleIntervalMs: 600,
        durationMs: 3000
      }
    ];

    expect(buildStickerTriggerEvents(event, rules)).toEqual([
      {
        type: "sticker_triggered",
        source: "sticker-rules",
        text: "这里卡住了",
        metadata: {
          triggerId: "stuck-cycle:2026-05-14T01:02:03.000Z:0",
          ruleId: "stuck-cycle",
          matchedKeyword: "卡住",
          promptSource: "codex-cli",
          asset: { type: "emoji", value: "😵" },
          assets: [
            { type: "emoji", value: "😵" },
            { type: "gif", path: "/tmp/stuck.gif", url: "file:///tmp/stuck.gif" }
          ],
          displayMode: "cycle",
          layout: { x: 0, y: 0, width: 1, height: 1, opacity: 0.75, fit: "cover" },
          cycleIntervalMs: 600,
          durationMs: 3000
        }
      }
    ]);
  });

  it("does not create triggers for non-prompt events", () => {
    const event: ContextEvent = {
      type: "ai_response_finished",
      source: "claude-code",
      timestamp: "2026-05-14T01:02:03.000Z",
      text: "不对"
    };

    expect(buildStickerTriggerEvents(event, [defaultStickerRule])).toEqual([]);
  });

  it("does not create triggers for prompt events from unsupported sources", () => {
    const event: ContextEvent = {
      type: "ai_prompt_submitted",
      source: "curl",
      timestamp: "2026-05-14T01:02:03.000Z",
      text: "这里不对"
    };

    expect(buildStickerTriggerEvents(event, [defaultStickerRule])).toEqual([]);
  });

  it("loads valid JSON config", async () => {
    const projectRoot = await tempProject();
    const configPath = join(projectRoot, "stickers.json");
    await writeFile(
      configPath,
      JSON.stringify([{ id: "ok", keywords: ["again"], asset: { type: "emoji", value: "😵" }, durationMs: 100 }])
    );

    await expect(loadStickerRules({ configPath, projectRoot })).resolves.toEqual([
      {
        id: "ok",
        keywords: ["again"],
        asset: { type: "emoji", value: "😵" },
        assets: [{ type: "emoji", value: "😵" }],
        displayMode: "single",
        cycleIntervalMs: 750,
        durationMs: 100
      }
    ]);
  });
});
