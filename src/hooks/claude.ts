import { postEvent } from "../client.js";
import { ContextEvent } from "../types.js";
import { assistantTextFrom, baseEvent, findLastAssistantTextFromJsonl, hookEventName, metadataFrom, promptTextFrom, readStdinJson } from "./shared.js";

const source = "claude-code";

export async function buildClaudeEvents(input: Record<string, unknown>): Promise<Omit<ContextEvent, "timestamp">[]> {
  const name = hookEventName(input);
  if (name === "UserPromptSubmit") {
    return [{ ...baseEvent(input, "ai_prompt_submitted", source), text: promptTextFrom(input) }];
  }

  if (name === "Stop") {
    const transcriptPath = typeof input.transcript_path === "string" ? input.transcript_path : undefined;
    let text = assistantTextFrom(input);
    const events: Omit<ContextEvent, "timestamp">[] = [];

    if (!text && transcriptPath) {
      try {
        text = await findLastAssistantTextFromJsonl(transcriptPath);
      } catch (error) {
        events.push({
          ...baseEvent(input, "hook_error", source),
          text: error instanceof Error ? error.message : String(error),
          metadata: metadataFrom(input, { phase: "transcript_parse" })
        });
      }
    }

    if (text) {
      events.push({ ...baseEvent(input, "ai_response_finished", source), text });
    }
    events.push({ ...baseEvent(input, "ai_task_finished", source) });
    return events;
  }

  return [];
}

async function main(): Promise<void> {
  try {
    const input = await readStdinJson();
    for (const event of await buildClaudeEvents(input)) {
      await postEvent(event);
    }
  } catch (error) {
    await postEvent({
      type: "hook_error",
      source,
      text: error instanceof Error ? error.message : String(error),
      metadata: { hookEventName: "unknown", phase: "hook_main" }
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => undefined);
}
