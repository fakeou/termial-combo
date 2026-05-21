import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { loadAppConfig, saveAppConfig } from "./appConfig.js";
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
  appConfig?: {
    configPath: string;
    projectRoot: string;
    assetDir?: string;
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

      if (req.method === "GET" && url.pathname === "/config" && options.appConfig) {
        const config = await loadAppConfig(options.appConfig);
        return sendJson(res, 200, { ok: true, config });
      }

      if (req.method === "PUT" && url.pathname === "/config" && options.appConfig) {
        const body = await readBody(req);
        const config = await saveAppConfig({
          ...options.appConfig,
          input: JSON.parse(body)
        });
        return sendJson(res, 200, { ok: true, config });
      }

      if (req.method === "POST" && url.pathname === "/assets" && options.appConfig) {
        const body = await readBody(req);
        const asset = await storeUploadedAsset(JSON.parse(body), options.appConfig);
        return sendJson(res, 201, { ok: true, asset });
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

async function storeUploadedAsset(
  input: unknown,
  options: NonNullable<ServerOptions["appConfig"]>
): Promise<{ type: "image" | "gif" | "video"; path: string }> {
  if (!isRecord(input)) throw new Error("Asset payload must be an object");
  const filename = typeof input.filename === "string" ? input.filename.trim() : "";
  const dataBase64 = typeof input.dataBase64 === "string" ? input.dataBase64.trim() : "";
  if (!filename) throw new Error("Asset filename is required");
  if (!dataBase64) throw new Error("Asset dataBase64 is required");

  const extension = extname(filename).toLowerCase();
  const type = assetTypeForExtension(extension);
  if (!type) throw new Error(`Unsupported asset extension: ${extension || "none"}`);

  const stem = basename(filename, extension)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "sticker";
  const safeFilename = `${stem}${extension}`;
  const assetDir = options.assetDir ?? join(options.projectRoot, "assets", "stickers");
  const absolutePath = join(assetDir, safeFilename);
  await mkdir(assetDir, { recursive: true });
  await writeFile(absolutePath, Buffer.from(dataBase64, "base64"));

  return {
    type,
    path: relative(options.projectRoot, absolutePath).replace(/\\/g, "/")
  };
}

function assetTypeForExtension(extension: string): "image" | "gif" | "video" | undefined {
  if (extension === ".gif") return "gif";
  if ([".mp4", ".webm", ".mov"].includes(extension)) return "video";
  if ([".png", ".jpg", ".jpeg", ".webp", ".avif"].includes(extension)) return "image";
  return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
