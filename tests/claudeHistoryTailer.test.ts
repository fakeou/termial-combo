import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeHistoryTailer, parseClaudeHistoryLine } from "../src/claude/historyTailer.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs.length = 0;
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claude-history-"));
  tempDirs.push(dir);
  return dir;
}

describe("parseClaudeHistoryLine", () => {
  it("maps Claude history JSONL records to prompt events", () => {
    expect(
      parseClaudeHistoryLine(
        JSON.stringify({
          display: "不对，重新来",
          pastedContents: {},
          timestamp: 1779691303140,
          project: "/Users/example/repo",
          sessionId: "claude-session"
        }),
        "/Users/example/.claude/history.jsonl"
      )
    ).toEqual({
      type: "ai_prompt_submitted",
      source: "claude-code",
      timestamp: "2026-05-25T06:41:43.140Z",
      sessionId: "claude-session",
      cwd: "/Users/example/repo",
      text: "不对，重新来",
      metadata: {
        historyPath: "/Users/example/.claude/history.jsonl",
        claudeHistoryTimestamp: 1779691303140,
        promptSource: "claude-history"
      }
    });
  });

  it("ignores invalid, empty, or slash-command history records", () => {
    expect(parseClaudeHistoryLine("{bad json", "/tmp/history.jsonl")).toBeUndefined();
    expect(parseClaudeHistoryLine(JSON.stringify({ display: "   " }), "/tmp/history.jsonl")).toBeUndefined();
    expect(parseClaudeHistoryLine(JSON.stringify({ display: "/model opus" }), "/tmp/history.jsonl")).toBeUndefined();
    expect(parseClaudeHistoryLine(JSON.stringify({ message: "不对" }), "/tmp/history.jsonl")).toBeUndefined();
  });
});

describe("ClaudeHistoryTailer", () => {
  it("starts at EOF by default and emits only appended prompt records", async () => {
    const dir = await tempDir();
    const historyPath = join(dir, "history.jsonl");
    await writeFile(
      historyPath,
      `${JSON.stringify({ display: "旧 prompt", timestamp: 1779691200000, sessionId: "old" })}\n`,
      "utf8"
    );
    const events: unknown[] = [];
    const tailer = new ClaudeHistoryTailer({
      historyPath,
      onEvent: (event) => {
        events.push(event);
      }
    });

    await tailer.initialize();
    await appendFile(
      historyPath,
      `${JSON.stringify({ display: "不行，重新来", timestamp: 1779691303140, sessionId: "new" })}\n`,
      "utf8"
    );
    await tailer.pollOnce();

    expect(events).toEqual([
      {
        type: "ai_prompt_submitted",
        source: "claude-code",
        timestamp: "2026-05-25T06:41:43.140Z",
        sessionId: "new",
        text: "不行，重新来",
        metadata: {
          historyPath,
          claudeHistoryTimestamp: 1779691303140,
          promptSource: "claude-history"
        }
      }
    ]);
  });

  it("can replay an existing file when startAtEnd is false", async () => {
    const dir = await tempDir();
    const historyPath = join(dir, "history.jsonl");
    await writeFile(
      historyPath,
      `${JSON.stringify({ display: "不对", timestamp: 1779691303140, sessionId: "old" })}\n`,
      "utf8"
    );
    const events: unknown[] = [];
    const tailer = new ClaudeHistoryTailer({
      historyPath,
      startAtEnd: false,
      onEvent: (event) => {
        events.push(event);
      }
    });

    await tailer.initialize();
    await tailer.pollOnce();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "ai_prompt_submitted", source: "claude-code", text: "不对" });
  });
});
