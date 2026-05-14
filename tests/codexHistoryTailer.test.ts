import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { CodexHistoryTailer, parseCodexHistoryLine } from "../src/codex/historyTailer.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs.length = 0;
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "codex-history-"));
  tempDirs.push(dir);
  return dir;
}

describe("parseCodexHistoryLine", () => {
  it("maps Codex history JSONL records to prompt events", () => {
    expect(
      parseCodexHistoryLine(
        JSON.stringify({
          session_id: "session-1",
          ts: 1778743216,
          text: "不对，重新来"
        }),
        "/Users/example/.codex/history.jsonl"
      )
    ).toEqual({
      type: "ai_prompt_submitted",
      source: "codex-cli",
      timestamp: "2026-05-14T07:20:16.000Z",
      sessionId: "session-1",
      text: "不对，重新来",
      metadata: {
        historyPath: "/Users/example/.codex/history.jsonl",
        codexHistoryTs: 1778743216
      }
    });
  });

  it("ignores invalid or empty history records", () => {
    expect(parseCodexHistoryLine("{bad json", "/tmp/history.jsonl")).toBeUndefined();
    expect(parseCodexHistoryLine(JSON.stringify({ session_id: "s1", text: "   " }), "/tmp/history.jsonl")).toBeUndefined();
    expect(parseCodexHistoryLine(JSON.stringify({ session_id: "s1" }), "/tmp/history.jsonl")).toBeUndefined();
  });
});

describe("CodexHistoryTailer", () => {
  it("starts at EOF by default and emits only appended prompt records", async () => {
    const dir = await tempDir();
    const historyPath = join(dir, "history.jsonl");
    await writeFile(
      historyPath,
      `${JSON.stringify({ session_id: "old", ts: 1778743000, text: "旧 prompt" })}\n`,
      "utf8"
    );
    const events: unknown[] = [];
    const tailer = new CodexHistoryTailer({
      historyPath,
      onEvent: (event) => {
        events.push(event);
      }
    });

    await tailer.initialize();
    await appendFile(
      historyPath,
      `${JSON.stringify({ session_id: "new", ts: 1778743216, text: "不行，重新来" })}\n`,
      "utf8"
    );
    await tailer.pollOnce();

    expect(events).toEqual([
      {
        type: "ai_prompt_submitted",
        source: "codex-cli",
        timestamp: "2026-05-14T07:20:16.000Z",
        sessionId: "new",
        text: "不行，重新来",
        metadata: {
          historyPath,
          codexHistoryTs: 1778743216
        }
      }
    ]);
  });

  it("can replay an existing file when startAtEnd is false", async () => {
    const dir = await tempDir();
    const historyPath = join(dir, "history.jsonl");
    await writeFile(
      historyPath,
      `${JSON.stringify({ session_id: "old", ts: 1778743216, text: "不对" })}\n`,
      "utf8"
    );
    const events: unknown[] = [];
    const tailer = new CodexHistoryTailer({
      historyPath,
      startAtEnd: false,
      onEvent: (event) => {
        events.push(event);
      }
    });

    await tailer.initialize();
    await tailer.pollOnce();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "ai_prompt_submitted", source: "codex-cli", text: "不对" });
  });
}
);
