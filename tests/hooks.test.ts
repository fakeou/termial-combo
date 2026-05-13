import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildClaudeEvents } from "../src/hooks/claude.js";
import { buildCodexEvents } from "../src/hooks/codex.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("Claude Code hook event builder", () => {
  it("maps UserPromptSubmit stdin JSON to ai_prompt_submitted", async () => {
    const events = await buildClaudeEvents({
      hook_event_name: "UserPromptSubmit",
      session_id: "claude-session",
      cwd: "/repo",
      prompt: "请实现一个 POC"
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "ai_prompt_submitted",
      source: "claude-code",
      sessionId: "claude-session",
      cwd: "/repo",
      text: "请实现一个 POC",
      metadata: { hookEventName: "UserPromptSubmit" }
    });
  });

  it("uses last_assistant_message on Stop and falls back to transcript parsing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-transcript-"));
    tempDirs.push(dir);
    const transcriptPath = join(dir, "transcript.jsonl");
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "old" }] } }),
        JSON.stringify({ role: "assistant", content: "final from transcript" })
      ].join("\n")
    );

    const events = await buildClaudeEvents({
      hook_event_name: "Stop",
      session_id: "claude-session",
      cwd: "/repo",
      transcript_path: transcriptPath
    });

    expect(events[0]).toMatchObject({
      type: "ai_response_finished",
      source: "claude-code",
      text: "final from transcript",
      metadata: { transcript_path: transcriptPath }
    });
    expect(events[1]).toMatchObject({ type: "ai_task_finished", source: "claude-code" });
  });
});

describe("Codex hook event builder", () => {
  it("maps a compatible UserPromptSubmit payload", async () => {
    const events = await buildCodexEvents({
      hook_event_name: "UserPromptSubmit",
      session_id: "codex-session",
      cwd: "/repo",
      prompt: "ship it",
      turn_id: "turn-1"
    });

    expect(events[0]).toMatchObject({
      type: "ai_prompt_submitted",
      source: "codex-cli",
      sessionId: "codex-session",
      text: "ship it",
      metadata: { hookEventName: "UserPromptSubmit", turnId: "turn-1" }
    });
  });

  it("maps Stop payloads with last assistant content", async () => {
    const events = await buildCodexEvents({
      hook_event_name: "Stop",
      session_id: "codex-session",
      cwd: "/repo",
      last_assistant_message: "all green"
    });

    expect(events.map((event) => event.type)).toEqual(["ai_response_finished", "ai_task_finished"]);
    expect(events[0].text).toBe("all green");
  });
});
