import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultAppConfig,
  loadAppConfig,
  normalizeAppConfig,
  saveAppConfig
} from "../src/appConfig.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs.length = 0;
});

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "termial-config-"));
  tempDirs.push(dir);
  return dir;
}

describe("app config", () => {
  it("normalizes combo editor settings and new multi-asset rules", () => {
    const config = normalizeAppConfig(
      {
        combo: {
          style: "custom",
          comboWindowMs: 9000,
          counter: {
            label: "CHAIN",
            subLabel: "OK",
            numberColor: "#ff00aa",
            textColor: "#00ffee",
            fontSize: 88,
            scale: 1.8,
            skewDeg: -30
          },
          background: { enabled: true, style: "sparks", opacity: 1.8 },
          animation: { enter: "slide", hit: "pulse", exit: "fade", fadeOutMs: 3000 }
        },
        rules: [
          {
            id: "retry-cycle",
            enabled: true,
            keywords: [" 不对 ", "", "重新来"],
            displayMode: "cycle",
            durationMs: 9000,
            cycleIntervalMs: 120,
            layout: {
              x: 0,
              y: 0,
              width: 1,
              height: 1,
              opacity: 0.8,
              fit: "cover"
            },
            assets: [
              { type: "emoji", value: "😵" },
              { type: "gif", path: "stickers/retry.gif" }
            ]
          }
        ]
      },
      "/tmp/project"
    );

    expect(config.combo).toMatchObject({
      style: "custom",
      comboWindowMs: 5000,
      counter: {
        label: "CHAIN",
        subLabel: "OK",
        numberColor: "#ff00aa",
        textColor: "#00ffee",
        fontSize: 72,
        scale: 1.5,
        skewDeg: -24
      },
      background: { enabled: true, style: "sparks", opacity: 1 },
      animation: { enter: "slide", hit: "pulse", exit: "fade", fadeOutMs: 2000 }
    });
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0]).toMatchObject({
      id: "retry-cycle",
      keywords: ["不对", "重新来"],
      displayMode: "cycle",
      layout: {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        opacity: 0.8,
        fit: "cover"
      },
      durationMs: 5000,
      cycleIntervalMs: 250,
      assets: [
        { type: "emoji", value: "😵" },
        { type: "gif", path: "/tmp/project/stickers/retry.gif", url: "file:///tmp/project/stickers/retry.gif" }
      ]
    });
  });

  it("keeps old sticker-rules.json shape valid", () => {
    const config = normalizeAppConfig(
      {
        rules: [
          {
            id: "retry",
            keywords: ["不对"],
            asset: { type: "emoji", value: "😵" },
            durationMs: 2000
          }
        ]
      },
      "/tmp/project"
    );

    expect(config.combo).toEqual(defaultAppConfig.combo);
    expect(config.rules[0]).toMatchObject({
      id: "retry",
      assets: [{ type: "emoji", value: "😵" }],
      asset: { type: "emoji", value: "😵" }
    });
  });

  it("loads defaults when missing and saves normalized config", async () => {
    const projectRoot = await tempProject();
    const configPath = join(projectRoot, "config.json");

    await expect(loadAppConfig({ configPath, projectRoot })).resolves.toEqual(defaultAppConfig);

    await saveAppConfig({
      configPath,
      projectRoot,
      input: {
        combo: { counter: { label: "CHAIN" } },
        rules: [{ id: "x", keywords: ["卡住"], asset: { type: "emoji", value: "🧊" }, durationMs: 1000 }]
      }
    });

    const saved = JSON.parse(await readFile(configPath, "utf8"));
    expect(saved.combo.counter.label).toBe("CHAIN");
    expect(saved.rules[0].asset.value).toBe("🧊");
  });

  it("falls back to default when every custom rule is invalid", () => {
    const config = normalizeAppConfig({ combo: { style: "gold" }, rules: [] }, "/tmp/project");

    expect(config.combo.style).toBe("gold");
    expect(config.rules).toEqual(defaultAppConfig.rules);
  });
});
