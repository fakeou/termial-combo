# Codex/Claude Sticker Rules Design

## Goal

Add a configurable rule system that monitors Codex and Claude user prompts, detects Chinese trigger phrases, and shows a short emoji/sticker/media overlay below the existing combo UI.

## Scope

- Monitor only user-submitted prompts from Codex and Claude.
- Match Chinese keywords using simple substring matching.
- Configure rules in a local JSON file.
- Support emoji, image, GIF, and MP4 stickers.
- Limit each sticker display duration to at most 5 seconds.
- Keep combo counting and Warp window positioning behavior unchanged.

## Architecture

The daemon owns rule evaluation. Existing Codex and Claude hooks continue to emit `ai_prompt_submitted` events to `POST /events`. When the daemon stores one of those events, it evaluates the prompt text against `config/sticker-rules.json`. For each matching rule, it appends a derived `sticker_triggered` event to the same store.

The overlay continues polling the daemon for recent events. It deduplicates `sticker_triggered` events by a stable trigger id and dispatches a renderer event that displays the configured asset below the combo card. The renderer owns presentation timing and hides the sticker after the sanitized duration.

This keeps source ingestion, rule matching, and visual rendering separated:

- Hooks produce normalized prompt events.
- The daemon applies user-configurable rules.
- Electron main consumes trigger events and forwards display commands.
- React renderer displays emoji/media assets.

## Event Model

Add `sticker_triggered` to `ContextEventType`.

Derived event shape:

```json
{
  "type": "sticker_triggered",
  "source": "sticker-rules",
  "timestamp": "2026-05-14T00:00:00.000Z",
  "cwd": "/repo",
  "sessionId": "codex-session",
  "text": "不对，重新来",
  "metadata": {
    "triggerId": "retry-emoji:1715660000000:0",
    "ruleId": "retry-emoji",
    "matchedKeyword": "不对",
    "promptSource": "codex-cli",
    "asset": {
      "type": "emoji",
      "value": "😵"
    },
    "durationMs": 2000
  }
}
```

`triggerId` only needs to be stable enough for overlay deduplication within the recent event window. It can be built from rule id, source event timestamp, and match index.

## Configuration

Default path:

```text
config/sticker-rules.json
```

The path can be overridden with:

```text
STICKER_RULES_PATH=/absolute/or/relative/path.json
```

Config format:

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
    },
    {
      "id": "custom-sticker",
      "enabled": true,
      "keywords": ["崩了"],
      "asset": {
        "type": "image",
        "path": "assets/stickers/boom.gif"
      },
      "durationMs": 3000
    },
    {
      "id": "mp4-sticker",
      "enabled": true,
      "keywords": ["卡住了"],
      "asset": {
        "type": "video",
        "path": "assets/stickers/stuck.mp4"
      },
      "durationMs": 5000
    }
  ]
}
```

Supported asset types:

- `emoji`: requires `value`.
- `image`: requires `path`; used for PNG/JPG/WebP/static images.
- `gif`: requires `path`; rendered with the same image path behavior.
- `video`: requires `path`; rendered as muted autoplay loop video.

Relative file paths resolve from the project root by default. The daemon converts valid file paths to renderer-safe `file://` URLs before creating a `sticker_triggered` event.

## Default Behavior

If `config/sticker-rules.json` does not exist, the daemon uses a built-in test rule:

```json
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
```

This lets the prompt monitoring flow be tested immediately without extra setup.

## Validation And Limits

- Disabled rules are ignored.
- Empty ids are rejected.
- Empty keyword arrays are ignored.
- Empty keyword strings are ignored.
- `durationMs` is clamped to `1..5000`.
- Invalid assets are ignored for that rule.
- Invalid JSON does not crash the daemon. The daemon records a `hook_error` event with phase `sticker_rules_load` and falls back to the built-in test rule.

## Matching

Matching is case-sensitive substring matching against the prompt text. The first matching keyword for a rule is recorded as `matchedKeyword`. Multiple rules can match the same prompt and create multiple `sticker_triggered` events.

The first implementation targets Chinese text only by convention: users configure Chinese keywords, and no segmentation, regex, pinyin conversion, or locale-specific normalization is required.

## Overlay Behavior

Electron main polls `/events` as it does today. In addition to Warp window events, it scans recent events for new `sticker_triggered` records. It deduplicates by `metadata.triggerId` and dispatches a `sticker-trigger` browser event to the renderer.

Renderer display rules:

- Show the sticker below the combo card.
- Emoji renders as text.
- Image and GIF render with `<img>`.
- MP4 renders with `<video muted autoplay loop playsInline>`.
- Hide the sticker after the event duration.
- A newer trigger replaces the currently visible sticker.
- Media load failure hides that sticker and leaves combo UI unaffected.

## Testing

Add focused tests for:

- Rule loading fallback when config is missing.
- Rule validation and duration clamping.
- Prompt substring matching for Chinese keywords.
- Derived `sticker_triggered` event creation when `POST /events` receives `ai_prompt_submitted`.
- No derived event for assistant/task/window events.
- Overlay sticker-event deduplication and display command extraction as pure logic.

Before implementation, align the existing combo theme tests with the current `comboThemeForCount` behavior so `pnpm test` has a meaningful baseline.

## Out Of Scope

- UI for uploading stickers.
- UI for editing rules.
- Regex matching.
- Assistant response matching.
- Watching Codex/Claude log files directly in the daemon.
- Persisting user preferences outside the JSON config.
