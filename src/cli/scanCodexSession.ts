import { extractCodexEventsFromFile } from "../codex/sessionParser.js";
import { postEvent } from "../client.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: pnpm codex:scan /path/to/codex-session.jsonl");
  process.exitCode = 1;
} else {
  const events = await extractCodexEventsFromFile(path);
  for (const event of events) {
    await postEvent(event);
    console.log(JSON.stringify(event));
  }
}
