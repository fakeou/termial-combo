import http from "node:http";
import { JsonlEventStore } from "./eventStore.js";
import { buildStickerTriggerEvents, StickerRule } from "./stickerRules.js";
import { ContextEvent } from "./types.js";

export interface ServerOptions {
  host?: string;
  port?: number;
  store: JsonlEventStore;
  stickerRules?: {
    load: () => Promise<StickerRule[]>;
    onError?: (error: unknown) => void | Promise<void>;
  };
  codexScan?: {
    scan: () => Promise<void>;
  };
}

export function createEventServer(options: ServerOptions): http.Server {
  const store = options.store;
  const stickerRules = options.stickerRules;

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/events") {
        return sendJson(res, 200, { events: store.recent() });
      }

      if (req.method === "POST" && url.pathname === "/events") {
        const body = await readBody(req);
        const event = await store.add(JSON.parse(body));
        console.log(JSON.stringify(event));
        await storeStickerTriggerEvents(event, store, stickerRules);
        return sendJson(res, 202, { ok: true, event });
      }

      if (req.method === "POST" && url.pathname === "/codex/scan" && options.codexScan) {
        await options.codexScan.scan();
        return sendJson(res, 202, { ok: true });
      }

      return sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendJson(res, 400, { ok: false, error: message });
    }
  });
}

async function storeStickerTriggerEvents(
  event: ContextEvent,
  store: JsonlEventStore,
  stickerRules: ServerOptions["stickerRules"]
): Promise<void> {
  if (!stickerRules) return;

  try {
    const rules = await stickerRules.load();
    const triggerEvents = buildStickerTriggerEvents(event, rules);
    for (const triggerEvent of triggerEvents) {
      const storedEvent = await store.add(triggerEvent);
      console.log(JSON.stringify(storedEvent));
    }
  } catch (error) {
    try {
      await stickerRules.onError?.(error);
    } catch {
      // Sticker rule failures must not fail the original event ingestion.
    }
  }
}

export async function listen(server: http.Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
