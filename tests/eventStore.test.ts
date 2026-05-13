import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/eventStore.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("JsonlEventStore", () => {
  it("normalizes accepted events, stores a bounded recent list, and appends JSONL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warp-context-"));
    tempDirs.push(dir);
    const logPath = join(dir, "events.jsonl");
    const store = new JsonlEventStore({ logPath, recentLimit: 2 });

    const first = await store.add({
      type: "ai_prompt_submitted",
      source: "test",
      text: "hello",
      cwd: "/tmp/demo"
    });
    const second = await store.add({ type: "ai_response_finished", source: "test", text: "done" });
    const third = await store.add({ type: "hook_error", source: "test", metadata: { error: "boom" } });

    expect(first.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(store.recent()).toEqual([second, third]);

    const lines = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ type: "ai_prompt_submitted", source: "test", text: "hello" });
  });

  it("rejects unknown event types", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warp-context-"));
    tempDirs.push(dir);
    const store = new JsonlEventStore({ logPath: join(dir, "events.jsonl"), recentLimit: 2 });

    await expect(store.add({ type: "unknown", source: "test" } as never)).rejects.toThrow(/Unsupported event type/);
  });
});
