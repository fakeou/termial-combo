import { join } from "node:path";
import { JsonlEventStore } from "../eventStore.js";
import { createEventServer, listen } from "../httpServer.js";
import { postEvent } from "../client.js";
import { getActiveWindowInfo, toWindowEvents, ActiveWindowInfo } from "../windowDetector.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "39877");
const logPath = process.env.EVENT_LOG_PATH ?? join(process.cwd(), "logs", "events.jsonl");
const recentLimit = Number(process.env.RECENT_EVENT_LIMIT ?? "100");
const pollMs = Number(process.env.WINDOW_POLL_MS ?? "1000");

const store = new JsonlEventStore({ logPath, recentLimit });
const server = createEventServer({ store });

await listen(server, port, host);
console.log(`[warp-ai-context] daemon listening on http://${host}:${port}`);
console.log(`[warp-ai-context] writing events to ${logPath}`);

let previous: ActiveWindowInfo | undefined;
let isPollingWindow = false;
let lastWindowErrorAt = 0;

setInterval(async () => {
  if (isPollingWindow) return;
  isPollingWindow = true;
  try {
    const current = await getActiveWindowInfo();
    if (!current) return;
    for (const event of toWindowEvents(previous, current, "active-win")) {
      await postEvent(event, `http://${host}:${port}/events`);
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
        `http://${host}:${port}/events`
      );
    }
  } finally {
    isPollingWindow = false;
  }
}, pollMs).unref();
