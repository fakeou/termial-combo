import { IncomingContextEvent } from "./types.js";

export async function postEvent(event: IncomingContextEvent, endpoint = defaultEndpoint()): Promise<void> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[warp-ai-context] failed to post event: ${message}`);
  }
}

export function defaultEndpoint(): string {
  return process.env.WARP_AI_CONTEXT_ENDPOINT ?? "http://127.0.0.1:39877/events";
}
