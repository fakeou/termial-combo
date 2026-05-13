import { describe, expect, it } from "vitest";
import { extractCodexEventsFromJsonl } from "../src/codex/sessionParser.js";

describe("extractCodexEventsFromJsonl", () => {
  it("extracts user and assistant messages from common Codex rollout JSONL shapes", () => {
    const events = extractCodexEventsFromJsonl(
      [
        JSON.stringify({ type: "session_meta", id: "session-1", cwd: "/repo" }),
        JSON.stringify({ type: "user_message", message: "hello" }),
        JSON.stringify({ type: "assistant_message", message: "hi back" }),
        JSON.stringify({ type: "response_item", item: { type: "message", role: "user", content: [{ type: "input_text", text: "next" }] } }),
        JSON.stringify({ type: "response_item", item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] } })
      ].join("\n"),
      { sessionId: "session-1", path: "/tmp/session.jsonl" }
    );

    expect(events.map((event) => [event.type, event.text])).toEqual([
      ["ai_prompt_submitted", "hello"],
      ["ai_response_finished", "hi back"],
      ["ai_prompt_submitted", "next"],
      ["ai_response_finished", "done"]
    ]);
    expect(events[0].metadata).toMatchObject({ logPath: "/tmp/session.jsonl" });
  });

  it("extracts messages from observed Codex 0.130 rollout payload records", () => {
    const events = extractCodexEventsFromJsonl(
      [
        JSON.stringify({ type: "session_meta", payload: { id: "session-2", cwd: "/repo" } }),
        JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "build this" } }),
        JSON.stringify({
          type: "response_item",
          payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "building" }] }
        }),
        JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "done", phase: "final" } })
      ].join("\n"),
      { path: "/tmp/rollout.jsonl" }
    );

    expect(events.map((event) => [event.source, event.type, event.text, event.sessionId, event.cwd])).toEqual([
      ["codex-cli-log", "ai_prompt_submitted", "build this", "session-2", "/repo"],
      ["codex-cli-log", "ai_response_finished", "building", "session-2", "/repo"],
      ["codex-cli-log", "ai_response_finished", "done", "session-2", "/repo"]
    ]);
  });
});
