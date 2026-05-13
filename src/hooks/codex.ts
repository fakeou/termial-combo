import { postEvent } from "../client.js";
import { ContextEvent } from "../types.js";
import { assistantTextFrom, baseEvent, hookEventName, promptTextFrom, readStdinJson } from "./shared.js";

const source = "codex-cli";

export async function buildCodexEvents(input: Record<string, unknown>): Promise<Omit<ContextEvent, "timestamp">[]> {
  const name = hookEventName(input);
  if (name === "UserPromptSubmit") {
    return [{ ...baseEvent(input, "ai_prompt_submitted", source), text: promptTextFrom(input) }];
  }

  if (name === "Stop") {
    const responseEvent = { ...baseEvent(input, "ai_response_finished", source), text: assistantTextFrom(input) };
    return [responseEvent, { ...baseEvent(input, "ai_task_finished", source) }];
  }

  return [];
}

async function main(): Promise<void> {
  try {
    const input = await readStdinJson();
    for (const event of await buildCodexEvents(input)) {
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
