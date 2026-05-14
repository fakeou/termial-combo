import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/eventStore.js";
import { createEventServer, listen } from "../src/httpServer.js";

const tempDirs: string[] = [];
const servers: ReturnType<typeof createEventServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("HTTP sticker rule derivation", () => {
  it("stores matching prompt events and derived sticker trigger events", async () => {
    const { endpoint, store } = await startTestServer({
      stickerRules: {
        load: async () => [
          { id: "retry", keywords: ["不对"], asset: { type: "emoji", value: "😵" }, durationMs: 2000 }
        ]
      }
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "ai_prompt_submitted",
        source: "codex-cli",
        text: "这里不对，请重新来",
        cwd: "/repo",
        sessionId: "session-1",
        metadata: { promptSource: "user" }
      })
    });

    expect(response.status).toBe(202);
    const events = store.recent();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "ai_prompt_submitted",
      source: "codex-cli",
      text: "这里不对，请重新来"
    });
    expect(events[1]).toMatchObject({
      type: "sticker_triggered",
      source: "sticker-rules",
      cwd: "/repo",
      sessionId: "session-1",
      text: "这里不对，请重新来",
      metadata: {
        ruleId: "retry",
        matchedKeyword: "不对",
        promptSource: "user",
        asset: { type: "emoji", value: "😵" },
        durationMs: 2000
      }
    });
  });

  it("does not derive sticker trigger events for non-prompt events", async () => {
    const { endpoint, store } = await startTestServer({
      stickerRules: {
        load: async () => [
          { id: "retry", keywords: ["不对"], asset: { type: "emoji", value: "😵" }, durationMs: 2000 }
        ]
      }
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ai_response_finished", source: "test-hook", text: "这里不对" })
    });

    expect(response.status).toBe(202);
    expect(store.recent()).toHaveLength(1);
    expect(store.recent()[0]).toMatchObject({ type: "ai_response_finished", text: "这里不对" });
  });

  it("does not derive sticker trigger events for prompts from unsupported sources", async () => {
    const { endpoint, store } = await startTestServer({
      stickerRules: {
        load: async () => [
          { id: "retry", keywords: ["不对"], asset: { type: "emoji", value: "😵" }, durationMs: 2000 }
        ]
      }
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "ai_prompt_submitted", source: "curl", text: "这里不对" })
    });

    expect(response.status).toBe(202);
    expect(store.recent()).toHaveLength(1);
    expect(store.recent()[0]).toMatchObject({ type: "ai_prompt_submitted", source: "curl", text: "这里不对" });
  });
});

describe("HTTP Codex scan trigger", () => {
  it("runs the configured Codex scan handler on demand", async () => {
    let scanCount = 0;
    const { baseUrl } = await startTestServer({
      codexScan: {
        scan: async () => {
          scanCount += 1;
        }
      }
    });

    const response = await fetch(`${baseUrl}/codex/scan`, { method: "POST" });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(scanCount).toBe(1);
  });
});

async function startTestServer(options: Omit<Parameters<typeof createEventServer>[0], "store">) {
  const dir = await mkdtemp(join(tmpdir(), "http-sticker-rules-"));
  tempDirs.push(dir);
  const store = new JsonlEventStore({ logPath: join(dir, "events.jsonl") });
  const server = createEventServer({ ...options, store });
  servers.push(server);

  await listen(server, 0, "127.0.0.1");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { baseUrl, endpoint: `${baseUrl}/events`, store };
}

async function closeServer(server: ReturnType<typeof createEventServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
