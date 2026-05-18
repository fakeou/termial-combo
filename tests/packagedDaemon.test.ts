import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildPackagedDaemonSpawnEnv } = require("../src/electron/packagedDaemon.cjs") as {
  buildPackagedDaemonSpawnEnv: (options: {
    baseEnv: NodeJS.ProcessEnv;
    eventLogPath: string;
    stickerRulesPath: string;
  }) => NodeJS.ProcessEnv;
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
      STICKER_RULES_PATH: "/app/config/sticker-rules.json"
    });
  });

  it("preserves explicit log and rule paths", () => {
    expect(
      buildPackagedDaemonSpawnEnv({
        baseEnv: {
          EVENT_LOG_PATH: "/custom/events.jsonl",
          STICKER_RULES_PATH: "/custom/sticker-rules.json"
        },
        eventLogPath: "/app/logs/events.jsonl",
        stickerRulesPath: "/app/config/sticker-rules.json"
      })
    ).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      EVENT_LOG_PATH: "/custom/events.jsonl",
      STICKER_RULES_PATH: "/custom/sticker-rules.json"
    });
  });
});
