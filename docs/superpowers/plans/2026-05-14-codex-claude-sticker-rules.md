# Codex/Claude Sticker Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build configurable prompt-triggered emoji/sticker/media display for Codex and Claude user prompts.

**Architecture:** Keep Codex/Claude hooks emitting normalized `ai_prompt_submitted` events. Add daemon-side sticker rule loading and matching that derives `sticker_triggered` events, then have Electron main forward those events to the React overlay renderer for timed display below the combo UI.

**Tech Stack:** TypeScript, Node HTTP server, Electron CommonJS main process, React renderer, Vitest.

---

## File Structure

- Modify `src/types.ts`: add the `sticker_triggered` event type.
- Create `src/stickerRules.ts`: load, validate, clamp, match, and resolve sticker rule assets.
- Modify `src/httpServer.ts`: accept optional sticker rule engine and append derived events for prompt submissions.
- Modify `src/electron/main.cjs`: poll and deduplicate `sticker_triggered` events, then dispatch renderer commands.
- Modify `src/overlay/renderer.tsx`: listen for sticker triggers and render emoji/image/GIF/video stickers.
- Modify `src/overlay/style.css`: style the sticker area under the existing combo stage.
- Add `config/sticker-rules.json`: default editable sample config.
- Modify `tests/comboTheme.test.ts`: align stale expectations with current theme behavior.
- Add `tests/stickerRules.test.ts`: cover config fallback, validation, matching, duration clamping, and asset URL resolution.
- Add `tests/httpServerStickerRules.test.ts`: cover daemon-derived `sticker_triggered` events.
- Add `tests/overlayStickerEvents.test.ts`: cover pure extraction/dedup logic for Electron main.

## Task 1: Restore Current Test Baseline

**Files:**
- Modify: `tests/comboTheme.test.ts`
- Verify: `src/overlay/comboTheme.ts`

- [ ] **Step 1: Inspect current expectations and implementation**

Run:

```bash
sed -n '1,220p' tests/comboTheme.test.ts
sed -n '1,220p' src/overlay/comboTheme.ts
```

Expected: tests still expect old low-count `theme-blue` and mid-count thresholds, while implementation returns `theme-ash` for `<10`, `theme-blue` for `>=10`, `theme-violet` for `>=20`, `theme-crimson` for `>=30`, `theme-inferno` for `>=40`, and `theme-gold` for `>=50`.

- [ ] **Step 2: Update the test to current behavior**

Replace `tests/comboTheme.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { comboThemeForCount } from "../src/overlay/comboTheme.js";

describe("comboThemeForCount", () => {
  it("returns ash styling and C rank for low counts", () => {
    expect(comboThemeForCount(1)).toMatchObject({
      className: "theme-ash",
      rank: "C"
    });
  });

  it("progresses through stronger ranks and colors", () => {
    expect(comboThemeForCount(10)).toMatchObject({ className: "theme-blue", rank: "B" });
    expect(comboThemeForCount(20)).toMatchObject({ className: "theme-violet", rank: "A" });
    expect(comboThemeForCount(30)).toMatchObject({ className: "theme-crimson", rank: "S" });
    expect(comboThemeForCount(40)).toMatchObject({ className: "theme-inferno", rank: "SS" });
    expect(comboThemeForCount(50)).toMatchObject({ className: "theme-gold", rank: "SSS" });
  });

  it("keeps SSS for very high counts", () => {
    expect(comboThemeForCount(100)).toMatchObject({ className: "theme-gold", rank: "SSS" });
  });
});
```

- [ ] **Step 3: Run the focused test**

Run:

```bash
pnpm vitest run tests/comboTheme.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add tests/comboTheme.test.ts
git commit -m "test: align combo theme expectations"
```

Expected: commit succeeds.

## Task 2: Add Sticker Rule Types And Matching

**Files:**
- Modify: `src/types.ts`
- Create: `src/stickerRules.ts`
- Test: `tests/stickerRules.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/stickerRules.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildStickerTriggerEvents,
  defaultStickerRule,
  loadStickerRules,
  normalizeStickerRules
} from "../src/stickerRules.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("loadStickerRules", () => {
  it("uses the built-in retry emoji rule when the config file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sticker-rules-"));
    tempDirs.push(dir);

    const rules = await loadStickerRules({ configPath: join(dir, "missing.json"), projectRoot: dir });

    expect(rules).toEqual([defaultStickerRule]);
  });

  it("normalizes valid rules, drops invalid rules, clamps duration, and resolves file URLs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sticker-rules-"));
    tempDirs.push(dir);
    const configPath = join(dir, "rules.json");
    const assetPath = join(dir, "assets", "boom.gif");
    await writeFile(configPath, JSON.stringify({
      rules: [
        {
          id: "too-long",
          enabled: true,
          keywords: ["崩了", ""],
          asset: { type: "gif", path: "assets/boom.gif" },
          durationMs: 9000
        },
        {
          id: "disabled",
          enabled: false,
          keywords: ["忽略"],
          asset: { type: "emoji", value: "x" },
          durationMs: 1000
        },
        {
          id: "",
          enabled: true,
          keywords: ["bad"],
          asset: { type: "emoji", value: "x" },
          durationMs: 1000
        }
      ]
    }));

    const rules = await loadStickerRules({ configPath, projectRoot: dir });

    expect(assetPath.endsWith("assets/boom.gif")).toBe(true);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      id: "too-long",
      keywords: ["崩了"],
      asset: { type: "gif" },
      durationMs: 5000
    });
    expect(rules[0].asset).toHaveProperty("url");
    expect((rules[0].asset as { url: string }).url).toMatch(/^file:\/\//);
  });
});

describe("normalizeStickerRules", () => {
  it("returns the fallback rule for invalid config shapes", () => {
    expect(normalizeStickerRules({ nope: [] }, "/repo")).toEqual([defaultStickerRule]);
  });

  it("keeps emoji rules with clamped minimum duration", () => {
    expect(normalizeStickerRules({
      rules: [
        {
          id: "short",
          enabled: true,
          keywords: ["不行"],
          asset: { type: "emoji", value: "😵" },
          durationMs: -10
        }
      ]
    }, "/repo")).toEqual([
      {
        id: "short",
        keywords: ["不行"],
        asset: { type: "emoji", value: "😵" },
        durationMs: 1
      }
    ]);
  });
});

describe("buildStickerTriggerEvents", () => {
  it("creates trigger events for matching prompt keywords", () => {
    const events = buildStickerTriggerEvents({
      type: "ai_prompt_submitted",
      source: "codex-cli",
      timestamp: "2026-05-14T00:00:00.000Z",
      cwd: "/repo",
      sessionId: "session-1",
      text: "这个不对，重新来"
    }, [
      {
        id: "retry-emoji",
        keywords: ["不对", "不行", "重新来"],
        asset: { type: "emoji", value: "😵" },
        durationMs: 2000
      }
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "sticker_triggered",
      source: "sticker-rules",
      cwd: "/repo",
      sessionId: "session-1",
      text: "这个不对，重新来",
      metadata: {
        ruleId: "retry-emoji",
        matchedKeyword: "不对",
        promptSource: "codex-cli",
        asset: { type: "emoji", value: "😵" },
        durationMs: 2000
      }
    });
    expect(events[0].metadata?.triggerId).toBe("retry-emoji:2026-05-14T00:00:00.000Z:0");
  });

  it("does not create trigger events for non-prompt events", () => {
    const events = buildStickerTriggerEvents({
      type: "ai_response_finished",
      source: "codex-cli",
      timestamp: "2026-05-14T00:00:00.000Z",
      text: "不对"
    }, [defaultStickerRule]);

    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm vitest run tests/stickerRules.test.ts
```

Expected: FAIL because `src/stickerRules.ts` does not exist and `sticker_triggered` is not a known event type.

- [ ] **Step 3: Add the event type**

In `src/types.ts`, add `"sticker_triggered"` to `eventTypes` after `"hook_error"`:

```ts
export const eventTypes = [
  "ai_prompt_submitted",
  "ai_response_finished",
  "ai_task_started",
  "ai_task_finished",
  "active_app_changed",
  "active_window_changed",
  "warp_window_detected",
  "hook_error",
  "sticker_triggered"
] as const;
```

- [ ] **Step 4: Implement sticker rule module**

Create `src/stickerRules.ts`:

```ts
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ContextEvent, JsonObject } from "./types.js";

export type StickerAsset =
  | { type: "emoji"; value: string }
  | { type: "image" | "gif" | "video"; path: string; url: string };

export interface StickerRule {
  id: string;
  keywords: string[];
  asset: StickerAsset;
  durationMs: number;
}

export interface LoadStickerRulesOptions {
  configPath: string;
  projectRoot: string;
}

export const defaultStickerRule: StickerRule = {
  id: "retry-emoji",
  keywords: ["不对", "不行", "重新来"],
  asset: { type: "emoji", value: "😵" },
  durationMs: 2000
};

export async function loadStickerRules(options: LoadStickerRulesOptions): Promise<StickerRule[]> {
  try {
    const raw = await readFile(options.configPath, "utf8");
    return normalizeStickerRules(JSON.parse(raw), options.projectRoot);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [defaultStickerRule];
    }
    throw error;
  }
}

export function normalizeStickerRules(input: unknown, projectRoot: string): StickerRule[] {
  if (!input || typeof input !== "object" || !Array.isArray((input as { rules?: unknown }).rules)) {
    return [defaultStickerRule];
  }

  const rules = (input as { rules: unknown[] }).rules
    .map((rule) => normalizeStickerRule(rule, projectRoot))
    .filter((rule): rule is StickerRule => Boolean(rule));

  return rules.length > 0 ? rules : [defaultStickerRule];
}

export function buildStickerTriggerEvents(event: ContextEvent, rules: StickerRule[]): Omit<ContextEvent, "timestamp">[] {
  if (event.type !== "ai_prompt_submitted" || !event.text) return [];

  const triggers: Omit<ContextEvent, "timestamp">[] = [];
  rules.forEach((rule, index) => {
    const matchedKeyword = rule.keywords.find((keyword) => event.text?.includes(keyword));
    if (!matchedKeyword) return;
    triggers.push({
      type: "sticker_triggered",
      source: "sticker-rules",
      ...(event.cwd ? { cwd: event.cwd } : {}),
      ...(event.sessionId ? { sessionId: event.sessionId } : {}),
      text: event.text,
      metadata: {
        triggerId: `${rule.id}:${event.timestamp}:${index}`,
        ruleId: rule.id,
        matchedKeyword,
        promptSource: event.source,
        asset: rule.asset as unknown as JsonObject,
        durationMs: rule.durationMs
      }
    });
  });

  return triggers;
}

function normalizeStickerRule(input: unknown, projectRoot: string): StickerRule | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  if (record.enabled === false) return undefined;

  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) return undefined;

  const keywords = Array.isArray(record.keywords)
    ? record.keywords.filter((keyword): keyword is string => typeof keyword === "string").map((keyword) => keyword.trim()).filter(Boolean)
    : [];
  if (keywords.length === 0) return undefined;

  const asset = normalizeAsset(record.asset, projectRoot);
  if (!asset) return undefined;

  return {
    id,
    keywords,
    asset,
    durationMs: clampDuration(record.durationMs)
  };
}

function normalizeAsset(input: unknown, projectRoot: string): StickerAsset | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  if (record.type === "emoji") {
    const value = typeof record.value === "string" ? record.value.trim() : "";
    return value ? { type: "emoji", value } : undefined;
  }

  if (record.type === "image" || record.type === "gif" || record.type === "video") {
    const path = typeof record.path === "string" ? record.path.trim() : "";
    if (!path) return undefined;
    const absolutePath = isAbsolute(path) ? path : resolve(projectRoot, path);
    return {
      type: record.type,
      path,
      url: pathToFileURL(absolutePath).toString()
    };
  }

  return undefined;
}

function clampDuration(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : defaultStickerRule.durationMs;
  return Math.max(1, Math.min(5000, Math.round(number)));
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm vitest run tests/stickerRules.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/types.ts src/stickerRules.ts tests/stickerRules.test.ts
git commit -m "feat: add sticker rule matching"
```

Expected: commit succeeds.

## Task 3: Derive Sticker Events In The HTTP Server

**Files:**
- Modify: `src/httpServer.ts`
- Modify: `src/cli/daemon.ts`
- Test: `tests/httpServerStickerRules.test.ts`

- [ ] **Step 1: Write failing server tests**

Create `tests/httpServerStickerRules.test.ts`:

```ts
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlEventStore } from "../src/eventStore.js";
import { createEventServer, listen } from "../src/httpServer.js";
import { defaultStickerRule } from "../src/stickerRules.js";

const tempDirs: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.length = 0;
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("createEventServer sticker rules", () => {
  it("stores prompt events and derived sticker trigger events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sticker-server-"));
    tempDirs.push(dir);
    const store = new JsonlEventStore({ logPath: join(dir, "events.jsonl") });
    const server = createEventServer({
      store,
      stickerRules: {
        load: async () => [defaultStickerRule],
        onError: async () => undefined
      }
    });
    servers.push(server);
    await listen(server, 0, "127.0.0.1");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");

    const response = await fetch(`http://127.0.0.1:${address.port}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "ai_prompt_submitted",
        source: "codex-cli",
        text: "不对，重新来"
      })
    });

    expect(response.status).toBe(202);
    const events = store.recent();
    expect(events.map((event) => event.type)).toEqual(["ai_prompt_submitted", "sticker_triggered"]);
    expect(events[1].metadata).toMatchObject({
      ruleId: "retry-emoji",
      matchedKeyword: "不对",
      promptSource: "codex-cli"
    });
  });

  it("does not derive sticker events for non-prompt events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sticker-server-"));
    tempDirs.push(dir);
    const store = new JsonlEventStore({ logPath: join(dir, "events.jsonl") });
    const server = createEventServer({
      store,
      stickerRules: {
        load: async () => [defaultStickerRule],
        onError: async () => undefined
      }
    });
    servers.push(server);
    await listen(server, 0, "127.0.0.1");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");

    await fetch(`http://127.0.0.1:${address.port}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "ai_response_finished",
        source: "codex-cli",
        text: "不对"
      })
    });

    expect(store.recent().map((event) => event.type)).toEqual(["ai_response_finished"]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm vitest run tests/httpServerStickerRules.test.ts
```

Expected: FAIL because `createEventServer` does not accept `stickerRules`.

- [ ] **Step 3: Update HTTP server options and event derivation**

Modify `src/httpServer.ts`:

```ts
import http from "node:http";
import { JsonlEventStore } from "./eventStore.js";
import { buildStickerTriggerEvents, StickerRule } from "./stickerRules.js";

export interface StickerRuleEngine {
  load: () => Promise<StickerRule[]>;
  onError?: (error: unknown) => Promise<void> | void;
}

export interface ServerOptions {
  host?: string;
  port?: number;
  store: JsonlEventStore;
  stickerRules?: StickerRuleEngine;
}

export function createEventServer(options: ServerOptions): http.Server {
  const store = options.store;

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/events") {
        return sendJson(res, 200, { events: store.recent() });
      }

      if (req.method === "POST" && url.pathname === "/events") {
        const body = await readBody(req);
        const event = await store.add(JSON.parse(body));
        console.log(JSON.stringify(event));
        if (options.stickerRules) {
          try {
            const rules = await options.stickerRules.load();
            for (const trigger of buildStickerTriggerEvents(event, rules)) {
              const triggerEvent = await store.add(trigger);
              console.log(JSON.stringify(triggerEvent));
            }
          } catch (error) {
            await options.stickerRules.onError?.(error);
          }
        }
        return sendJson(res, 202, { ok: true, event });
      }

      return sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendJson(res, 400, { ok: false, error: message });
    }
  });
}

export async function listen(server: http.Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
```

- [ ] **Step 4: Wire rules into daemon**

Modify `src/cli/daemon.ts` imports and server creation:

```ts
import { join, resolve } from "node:path";
import { JsonlEventStore } from "../eventStore.js";
import { createEventServer, listen } from "../httpServer.js";
import { postEvent } from "../client.js";
import { getActiveWindowInfo, toWindowEvents, ActiveWindowInfo } from "../windowDetector.js";
import { loadStickerRules } from "../stickerRules.js";
```

Replace:

```ts
const server = createEventServer({ store });
```

with:

```ts
const stickerRulesPath = process.env.STICKER_RULES_PATH
  ? resolve(process.env.STICKER_RULES_PATH)
  : join(process.cwd(), "config", "sticker-rules.json");

const server = createEventServer({
  store,
  stickerRules: {
    load: () => loadStickerRules({ configPath: stickerRulesPath, projectRoot: process.cwd() }),
    onError: async (error) => {
      await store.add({
        type: "hook_error",
        source: "sticker-rules",
        text: error instanceof Error ? error.message : String(error),
        metadata: { phase: "sticker_rules_load", configPath: stickerRulesPath }
      });
    }
  }
});
```

Add a daemon startup log after event log path:

```ts
console.log(`[warp-ai-context] reading sticker rules from ${stickerRulesPath}`);
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm vitest run tests/httpServerStickerRules.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/httpServer.ts src/cli/daemon.ts tests/httpServerStickerRules.test.ts
git commit -m "feat: derive sticker trigger events"
```

Expected: commit succeeds.

## Task 4: Extract Overlay Sticker Event Commands

**Files:**
- Create: `src/overlay/stickerEvents.ts`
- Test: `tests/overlayStickerEvents.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/overlayStickerEvents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractNewStickerCommands } from "../src/overlay/stickerEvents.js";
import { ContextEvent } from "../src/types.js";

describe("extractNewStickerCommands", () => {
  it("extracts unseen sticker trigger events and marks them seen", () => {
    const seen = new Set<string>();
    const events: ContextEvent[] = [
      {
        type: "sticker_triggered",
        source: "sticker-rules",
        timestamp: "2026-05-14T00:00:00.000Z",
        text: "不对",
        metadata: {
          triggerId: "retry:1",
          ruleId: "retry",
          matchedKeyword: "不对",
          promptSource: "codex-cli",
          asset: { type: "emoji", value: "😵" },
          durationMs: 2000
        }
      }
    ];

    expect(extractNewStickerCommands(events, seen)).toEqual([
      {
        triggerId: "retry:1",
        asset: { type: "emoji", value: "😵" },
        durationMs: 2000,
        matchedKeyword: "不对",
        ruleId: "retry"
      }
    ]);
    expect(extractNewStickerCommands(events, seen)).toEqual([]);
  });

  it("ignores malformed trigger events and clamps duration", () => {
    const seen = new Set<string>();
    const events: ContextEvent[] = [
      {
        type: "sticker_triggered",
        source: "sticker-rules",
        timestamp: "2026-05-14T00:00:00.000Z",
        metadata: {
          triggerId: "gif:1",
          ruleId: "gif",
          matchedKeyword: "崩了",
          asset: { type: "gif", url: "file:///tmp/boom.gif" },
          durationMs: 9000
        }
      },
      {
        type: "sticker_triggered",
        source: "sticker-rules",
        timestamp: "2026-05-14T00:00:01.000Z",
        metadata: {
          triggerId: "bad:1",
          asset: { type: "gif" },
          durationMs: 1000
        }
      }
    ];

    expect(extractNewStickerCommands(events, seen)).toEqual([
      {
        triggerId: "gif:1",
        asset: { type: "gif", url: "file:///tmp/boom.gif" },
        durationMs: 5000,
        matchedKeyword: "崩了",
        ruleId: "gif"
      }
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm vitest run tests/overlayStickerEvents.test.ts
```

Expected: FAIL because `src/overlay/stickerEvents.ts` does not exist.

- [ ] **Step 3: Implement pure extraction logic**

Create `src/overlay/stickerEvents.ts`:

```ts
import { ContextEvent } from "../types.js";

export type StickerCommandAsset =
  | { type: "emoji"; value: string }
  | { type: "image" | "gif" | "video"; url: string };

export interface StickerCommand {
  triggerId: string;
  asset: StickerCommandAsset;
  durationMs: number;
  matchedKeyword?: string;
  ruleId?: string;
}

export function extractNewStickerCommands(events: ContextEvent[], seenTriggerIds: Set<string>): StickerCommand[] {
  const commands: StickerCommand[] = [];
  for (const event of events) {
    const command = stickerCommandFromEvent(event);
    if (!command || seenTriggerIds.has(command.triggerId)) continue;
    seenTriggerIds.add(command.triggerId);
    commands.push(command);
  }
  return commands;
}

function stickerCommandFromEvent(event: ContextEvent): StickerCommand | undefined {
  if (event.type !== "sticker_triggered") return undefined;
  const metadata = event.metadata ?? {};
  const triggerId = typeof metadata.triggerId === "string" ? metadata.triggerId : "";
  if (!triggerId) return undefined;

  const asset = assetFromUnknown(metadata.asset);
  if (!asset) return undefined;

  return {
    triggerId,
    asset,
    durationMs: clampDuration(metadata.durationMs),
    matchedKeyword: typeof metadata.matchedKeyword === "string" ? metadata.matchedKeyword : undefined,
    ruleId: typeof metadata.ruleId === "string" ? metadata.ruleId : undefined
  };
}

function assetFromUnknown(input: unknown): StickerCommandAsset | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  if (record.type === "emoji") {
    const value = typeof record.value === "string" ? record.value : "";
    return value ? { type: "emoji", value } : undefined;
  }
  if (record.type === "image" || record.type === "gif" || record.type === "video") {
    const url = typeof record.url === "string" ? record.url : "";
    return url ? { type: record.type, url } : undefined;
  }
  return undefined;
}

function clampDuration(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 2000;
  return Math.max(1, Math.min(5000, Math.round(number)));
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm vitest run tests/overlayStickerEvents.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/overlay/stickerEvents.ts tests/overlayStickerEvents.test.ts
git commit -m "feat: extract overlay sticker commands"
```

Expected: commit succeeds.

## Task 5: Forward Sticker Commands From Electron Main

**Files:**
- Modify: `src/electron/main.cjs`
- Verify: `src/overlay/stickerEvents.ts`

- [ ] **Step 1: Add equivalent CommonJS extraction helpers**

In `src/electron/main.cjs`, add a top-level set near the other state variables:

```js
const seenStickerTriggerIds = new Set();
```

Add helper functions near `getWarpWindowFromDaemon`:

```js
function extractNewStickerCommands(events) {
  const commands = [];
  for (const event of events || []) {
    const command = stickerCommandFromEvent(event);
    if (!command || seenStickerTriggerIds.has(command.triggerId)) continue;
    seenStickerTriggerIds.add(command.triggerId);
    commands.push(command);
  }
  return commands;
}

function stickerCommandFromEvent(event) {
  if (!event || event.type !== "sticker_triggered") return undefined;
  const metadata = event.metadata || {};
  const triggerId = typeof metadata.triggerId === "string" ? metadata.triggerId : "";
  if (!triggerId) return undefined;
  const asset = stickerAssetFromUnknown(metadata.asset);
  if (!asset) return undefined;
  return {
    triggerId,
    asset,
    durationMs: clampStickerDuration(metadata.durationMs),
    matchedKeyword: typeof metadata.matchedKeyword === "string" ? metadata.matchedKeyword : undefined,
    ruleId: typeof metadata.ruleId === "string" ? metadata.ruleId : undefined
  };
}

function stickerAssetFromUnknown(input) {
  if (!input || typeof input !== "object") return undefined;
  if (input.type === "emoji") {
    return typeof input.value === "string" && input.value ? { type: "emoji", value: input.value } : undefined;
  }
  if (input.type === "image" || input.type === "gif" || input.type === "video") {
    return typeof input.url === "string" && input.url ? { type: input.type, url: input.url } : undefined;
  }
  return undefined;
}

function clampStickerDuration(value) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 2000;
  return Math.max(1, Math.min(5000, Math.round(number)));
}
```

- [ ] **Step 2: Fetch events once per overlay poll**

Create a helper:

```js
async function getRecentDaemonEvents() {
  try {
    const response = await fetch(daemonEventsUrl);
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload.events) ? payload.events : [];
  } catch {
    return [];
  }
}
```

Replace the start of `updateOverlay()`:

```js
const active = await getWarpWindowFromDaemon(forceLastWarp);
```

with:

```js
const events = await getRecentDaemonEvents();
await forwardStickerCommands(events);
const active = getWarpWindowFromEvents(events, forceLastWarp);
```

- [ ] **Step 3: Replace daemon window lookup helper**

Replace `getWarpWindowFromDaemon(useLastWarp)` with:

```js
function getWarpWindowFromEvents(events, useLastWarp) {
  const latest = [...(events || [])]
    .reverse()
    .find((event) => event.type === "warp_window_detected" || (!useLastWarp && event.type === "active_app_changed"));
  if (!latest || latest.type !== "warp_window_detected") return undefined;
  const metadata = latest.metadata || {};
  if (!metadata.bounds || typeof metadata.bounds !== "object") return undefined;
  return {
    appName: String(metadata.appName || "Warp"),
    bundleId: typeof metadata.bundleId === "string" ? metadata.bundleId : undefined,
    pid: typeof metadata.pid === "number" ? metadata.pid : undefined,
    title: typeof metadata.title === "string" ? metadata.title : undefined,
    bounds: metadata.bounds
  };
}
```

- [ ] **Step 4: Dispatch commands to renderer**

Add:

```js
async function forwardStickerCommands(events) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  for (const command of extractNewStickerCommands(events)) {
    const detail = JSON.stringify(command);
    await overlayWindow.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent("sticker-trigger", { detail: ${detail} }))`
    ).catch(() => {});
  }
}
```

- [ ] **Step 5: Run Electron build**

Run:

```bash
pnpm build:electron
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS. This does not typecheck `main.cjs`, so also inspect the edited CommonJS syntax carefully.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/electron/main.cjs
git commit -m "feat: forward sticker triggers to overlay"
```

Expected: commit succeeds.

## Task 6: Render Stickers In The React Overlay

**Files:**
- Modify: `src/overlay/renderer.tsx`
- Modify: `src/overlay/style.css`

- [ ] **Step 1: Add renderer state and listener**

In `src/overlay/renderer.tsx`, add these types near the constants:

```ts
type StickerAsset =
  | { type: "emoji"; value: string }
  | { type: "image" | "gif" | "video"; url: string };

interface StickerDisplay {
  triggerId: string;
  asset: StickerAsset;
  durationMs: number;
}
```

Inside `OverlayBadge()`, add state:

```ts
const stickerTimeoutRef = React.useRef<number | undefined>(undefined);
const [sticker, setSticker] = React.useState<StickerDisplay | undefined>();
```

Add an effect after the combo settings effect:

```ts
React.useEffect(() => {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<StickerDisplay>).detail;
    if (!isStickerDisplay(detail)) return;
    if (stickerTimeoutRef.current) {
      window.clearTimeout(stickerTimeoutRef.current);
    }
    setSticker(detail);
    stickerTimeoutRef.current = window.setTimeout(() => {
      setSticker(undefined);
      stickerTimeoutRef.current = undefined;
    }, Math.max(1, Math.min(5000, Math.round(detail.durationMs))));
  };
  window.addEventListener("sticker-trigger", listener);
  return () => {
    window.removeEventListener("sticker-trigger", listener);
    if (stickerTimeoutRef.current) window.clearTimeout(stickerTimeoutRef.current);
  };
}, []);
```

Add helper functions before `launchSssFireworks`:

```ts
function isStickerDisplay(value: unknown): value is StickerDisplay {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.triggerId === "string" && isStickerAsset(record.asset) && typeof record.durationMs === "number";
}

function isStickerAsset(value: unknown): value is StickerAsset {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.type === "emoji") return typeof record.value === "string" && record.value.length > 0;
  if (record.type === "image" || record.type === "gif" || record.type === "video") {
    return typeof record.url === "string" && record.url.length > 0;
  }
  return false;
}
```

- [ ] **Step 2: Render below the combo stage**

Inside the returned `<main>`, after the combo stage block and before `{fireworksActive && ...}`, add:

```tsx
{sticker && (
  <section className="sticker-stage" key={sticker.triggerId} aria-label="Prompt sticker">
    {sticker.asset.type === "emoji" ? (
      <span className="sticker-emoji">{sticker.asset.value}</span>
    ) : sticker.asset.type === "video" ? (
      <video
        className="sticker-media"
        src={sticker.asset.url}
        muted
        autoPlay
        loop
        playsInline
        onError={() => setSticker(undefined)}
      />
    ) : (
      <img className="sticker-media" src={sticker.asset.url} alt="" onError={() => setSticker(undefined)} />
    )}
  </section>
)}
```

- [ ] **Step 3: Add sticker CSS**

Append to `src/overlay/style.css` before keyframes:

```css
.sticker-stage {
  position: absolute;
  left: 50%;
  top: calc(50% + 78px);
  z-index: 6;
  width: 128px;
  height: 92px;
  display: grid;
  place-items: center;
  transform: translateX(-50%);
  pointer-events: none;
  animation: sticker-pop 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

.sticker-emoji {
  display: block;
  font-size: 56px;
  line-height: 1;
  filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.38));
}

.sticker-media {
  display: block;
  max-width: 128px;
  max-height: 92px;
  object-fit: contain;
  border-radius: 8px;
  filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.38));
}

@keyframes sticker-pop {
  0% {
    opacity: 0;
    transform: translateX(-50%) translateY(8px) scale(0.86);
  }
  100% {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }
}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/overlay/renderer.tsx src/overlay/style.css
git commit -m "feat: render prompt stickers in overlay"
```

Expected: commit succeeds.

## Task 7: Add Sample Configuration

**Files:**
- Create: `config/sticker-rules.json`
- Modify: `README.md`

- [ ] **Step 1: Create sample config**

Create `config/sticker-rules.json`:

```json
{
  "rules": [
    {
      "id": "retry-emoji",
      "enabled": true,
      "keywords": ["不对", "不行", "重新来"],
      "asset": {
        "type": "emoji",
        "value": "😵"
      },
      "durationMs": 2000
    }
  ]
}
```

- [ ] **Step 2: Update README**

In `README.md`, add this section after combo rules:

```md
## Prompt 贴纸规则

daemon 会监控 Claude Code / Codex CLI hook 发来的用户 prompt。默认配置在：

```text
config/sticker-rules.json
```

当 prompt 包含配置里的中文关键词时，overlay 会在 combo 下方显示 emoji、图片、GIF 或 MP4。`durationMs` 最大 5000，超过会自动裁剪。

示例：

```json
{
  "rules": [
    {
      "id": "retry-emoji",
      "enabled": true,
      "keywords": ["不对", "不行", "重新来"],
      "asset": {
        "type": "emoji",
        "value": "😵"
      },
      "durationMs": 2000
    }
  ]
}
```

图片、GIF、MP4 可以放在项目内，例如 `assets/stickers/boom.gif`：

```json
{
  "id": "boom-gif",
  "enabled": true,
  "keywords": ["崩了"],
  "asset": {
    "type": "gif",
    "path": "assets/stickers/boom.gif"
  },
  "durationMs": 3000
}
```

也可以用 `STICKER_RULES_PATH=/path/to/rules.json pnpm daemon` 指定其他配置文件。
```

- [ ] **Step 3: Commit**

Run:

```bash
git add config/sticker-rules.json README.md
git commit -m "docs: add sticker rule configuration"
```

Expected: commit succeeds.

## Task 8: Full Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run all tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Build Electron wrapper**

Run:

```bash
pnpm build:electron
```

Expected: PASS.

- [ ] **Step 4: Manual local flow smoke test**

Start daemon:

```bash
pnpm daemon
```

In another terminal, send a prompt event:

```bash
curl -X POST http://127.0.0.1:39877/events \
  -H 'content-type: application/json' \
  -d '{"type":"ai_prompt_submitted","source":"codex-cli","text":"不对，重新来"}'
```

Then inspect:

```bash
curl http://127.0.0.1:39877/events
```

Expected: recent events include both `ai_prompt_submitted` and `sticker_triggered`.

- [ ] **Step 5: Optional overlay visual smoke test**

Run:

```bash
OVERLAY_INPUT_COUNTER=1 pnpm overlay
```

Expected: with Warp active and daemon running, sending the curl prompt above causes the `😵` sticker to appear below the combo area for about 2 seconds.

- [ ] **Step 6: Final commit if verification edits were needed**

If any verification fixes were made:

```bash
git add <changed-files>
git commit -m "fix: stabilize sticker rule flow"
```

Expected: commit succeeds only if files changed during verification.

## Self-Review Notes

- Spec coverage: Tasks cover prompt-only monitoring, Chinese substring matching, local JSON config, emoji/image/GIF/video assets, duration limit, derived daemon events, overlay rendering, docs, and verification.
- Placeholder scan: No unresolved placeholder language remains in the implementation steps.
- Type consistency: `StickerRule`, `StickerAsset`, `sticker_triggered`, `triggerId`, `durationMs`, and `sticker-trigger` are used consistently across tasks.
