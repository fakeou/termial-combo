import http from "node:http";
import { JsonlEventStore } from "./eventStore.js";

export interface ServerOptions {
  host?: string;
  port?: number;
  store: JsonlEventStore;
}

export function createEventServer(options: ServerOptions): http.Server {
  const store = options.store;

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
        return sendJson(res, 202, { ok: true, event });
      }

      return sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendJson(res, 400, { ok: false, error: message });
    }
  });
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
