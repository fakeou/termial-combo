import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { JsonlEventStore } from "../eventStore.js";
import { createEventServer, listen } from "../httpServer.js";
import { postEvent } from "../client.js";
import { loadStickerRules } from "../stickerRules.js";
import { CodexHistoryTailer } from "../codex/historyTailer.js";
import { getActiveWindowInfo, toWindowEvents, ActiveWindowInfo } from "../windowDetector.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "39877");
const logPath = process.env.EVENT_LOG_PATH ?? join(process.cwd(), "logs", "events.jsonl");
const recentLimit = Number(process.env.RECENT_EVENT_LIMIT ?? "100");
const pollMs = Number(process.env.WINDOW_POLL_MS ?? "1000");
const endpoint = `http://${host}:${port}/events`;
const stickerRulesPath = process.env.STICKER_RULES_PATH
  ? resolve(process.env.STICKER_RULES_PATH)
  : resolve(process.cwd(), "config", "sticker-rules.json");
const codexHistoryTailEnabled = process.env.CODEX_HISTORY_TAIL !== "0";
const codexHistoryPath = process.env.CODEX_HISTORY_PATH
  ? resolve(process.env.CODEX_HISTORY_PATH)
  : join(homedir(), ".codex", "history.jsonl");
const codexHistoryPollMs = Number(process.env.CODEX_HISTORY_POLL_MS ?? "100");

const store = new JsonlEventStore({ logPath, recentLimit });
const server = createEventServer({
  store,
  stickerRules: {
    load: () => loadStickerRules({ configPath: stickerRulesPath, projectRoot: process.cwd() }),
    onError: async (error) => {
      await store.add({
        type: "hook_error",
        source: "sticker-rules",
        text: error instanceof Error ? error.message : String(error),
        metadata: {
          phase: "sticker_rules_load",
          configPath: stickerRulesPath
        }
      });
    }
  }
});

await listen(server, port, host);
console.log(`[warp-ai-context] daemon listening on http://${host}:${port}`);
console.log(`[warp-ai-context] writing events to ${logPath}`);
console.log(`[warp-ai-context] loading sticker rules from ${stickerRulesPath}`);
if (codexHistoryTailEnabled) {
  console.log(`[warp-ai-context] tailing Codex history from ${codexHistoryPath}`);
}

let previous: ActiveWindowInfo | undefined;
let isPollingWindow = false;
let lastWindowErrorAt = 0;
let lastCodexHistoryErrorAt = 0;

if (codexHistoryTailEnabled) {
  const codexHistoryTailer = new CodexHistoryTailer({
    historyPath: codexHistoryPath,
    pollMs: codexHistoryPollMs,
    onEvent: async (event) => {
      await postEvent(event, endpoint);
    },
    onError: async (error) => {
      const now = Date.now();
      if (now - lastCodexHistoryErrorAt <= 60_000) return;
      lastCodexHistoryErrorAt = now;
      await store.add({
        type: "hook_error",
        source: "codex-history",
        text: error instanceof Error ? error.message : String(error),
        metadata: {
          phase: "codex_history_tail",
          historyPath: codexHistoryPath,
          hint: "Set CODEX_HISTORY_TAIL=0 to disable Codex history monitoring."
        }
      });
    }
  });
  await codexHistoryTailer.start();
}

setInterval(async () => {
  if (isPollingWindow) return;
  isPollingWindow = true;
  try {
    const current = await getActiveWindowInfo();
    if (!current) return;
    for (const event of toWindowEvents(previous, current, "active-win")) {
      await postEvent(event, endpoint);
    }
    previous = current;
  } catch (error) {
    const now = Date.now();
    if (now - lastWindowErrorAt > 10_000) {
      lastWindowErrorAt = now;
      await postEvent(
        {
          type: "hook_error",
          source: "active-win",
          text: error instanceof Error ? error.message : String(error),
          metadata: {
            phase: "window_poll",
            hint: "Grant macOS Accessibility permission to the app that launched the daemon, then restart the daemon."
          }
        },
        endpoint
      );
    }
  } finally {
    isPollingWindow = false;
  }
}, pollMs).unref();
