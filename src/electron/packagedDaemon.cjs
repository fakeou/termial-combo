function buildPackagedDaemonSpawnEnv(options) {
  return {
    ...options.baseEnv,
    ELECTRON_RUN_AS_NODE: "1",
    EVENT_LOG_PATH: options.baseEnv.EVENT_LOG_PATH || options.eventLogPath,
    STICKER_RULES_PATH: options.baseEnv.STICKER_RULES_PATH || options.stickerRulesPath,
    APP_CONFIG_PATH: options.baseEnv.APP_CONFIG_PATH || options.stickerRulesPath
  };
}

function comboTriggerIdFromPromptEvent(event) {
  if (!event || event.type !== "ai_prompt_submitted") return undefined;
  if (event.source !== "codex-cli" && event.source !== "claude-code") return undefined;

  const timestamp = typeof event.timestamp === "string" ? event.timestamp : "";
  const source = typeof event.source === "string" ? event.source : "";
  const sessionId = typeof event.sessionId === "string" ? event.sessionId : "";
  const text = typeof event.text === "string" ? event.text : "";
  const id = [source, timestamp, sessionId, text].join("\u001f");

  return id.trim() ? id : undefined;
}

function hasUsableWarpBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return false;

  return (
    typeof bounds.x === "number" &&
    typeof bounds.y === "number" &&
    typeof bounds.width === "number" &&
    typeof bounds.height === "number" &&
    bounds.width >= 480 &&
    bounds.height >= 240
  );
}

function hasRecentStickerGrace(options) {
  return (
    options.hasLastUsableWarpWindow === true &&
    typeof options.now === "number" &&
    typeof options.lastStickerAt === "number" &&
    typeof options.graceMs === "number" &&
    options.lastStickerAt > 0 &&
    options.now - options.lastStickerAt <= options.graceMs
  );
}

function extractNewStickerCommands(events, seenTriggerIds) {
  const commands = [];
  const batchSeenTriggerIds = new Set(seenTriggerIds);

  for (const event of events) {
    const command = stickerCommandFromEvent(event, batchSeenTriggerIds);
    if (command) commands.push(command);
  }

  return commands;
}

function stickerCommandFromEvent(event, seenTriggerIds) {
  if (!event || event.type !== "sticker_triggered" || !isRecord(event.metadata)) return undefined;

  const triggerId = stringValue(event.metadata.triggerId);
  if (!triggerId || seenTriggerIds.has(triggerId)) return undefined;

  const asset = stickerAssetFromUnknown(event.metadata.asset);
  if (!asset) return undefined;

  seenTriggerIds.add(triggerId);
  const command = {
    triggerId,
    asset,
    durationMs: clampStickerDuration(event.metadata.durationMs)
  };

  const assets = stickerAssetsFromUnknown(event.metadata.assets);
  if (assets.length > 0) {
    command.assets = assets;
  }

  if (event.metadata.displayMode === "cycle" && (command.assets?.length || 0) > 1) {
    command.displayMode = "cycle";
    command.cycleIntervalMs = clampCycleInterval(event.metadata.cycleIntervalMs);
  }

  if (isRecord(event.metadata.layout)) {
    command.layout = clampStickerLayout(event.metadata.layout);
  }

  const matchedKeyword = stringValue(event.metadata.matchedKeyword);
  if (matchedKeyword) command.matchedKeyword = matchedKeyword;

  const ruleId = stringValue(event.metadata.ruleId);
  if (ruleId) command.ruleId = ruleId;

  return command;
}

function stickerAssetsFromUnknown(input) {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    const asset = stickerAssetFromUnknown(item);
    return asset ? [asset] : [];
  });
}

function stickerAssetFromUnknown(input) {
  if (!isRecord(input) || typeof input.type !== "string") return undefined;

  if (input.type === "emoji") {
    const emojiValue = stringValue(input.value);
    return emojiValue ? { type: "emoji", value: emojiValue } : undefined;
  }

  if (!isUrlStickerAssetType(input.type)) return undefined;

  const url = stringValue(input.url);
  return url ? { type: input.type, url } : undefined;
}

function clampStickerLayout(input) {
  return {
    x: clampNumber(input.x, 0, 1, 0.34),
    y: clampNumber(input.y, 0, 1, 0.64),
    width: clampNumber(input.width, 0.05, 1, 0.28),
    height: clampNumber(input.height, 0.05, 1, 0.24),
    opacity: clampNumber(input.opacity, 0, 1, 1),
    fit: input.fit === "cover" || input.fit === "fill" || input.fit === "contain" ? input.fit : "contain"
  };
}

function clampStickerDuration(value) {
  const duration = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 2000;
  return Math.min(5000, Math.max(1, duration));
}

function clampCycleInterval(value) {
  const duration = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 750;
  return Math.min(2000, Math.max(250, duration));
}

function clampNumber(value, min, max, fallback) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

function stringValue(value) {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isUrlStickerAssetType(value) {
  return value === "image" || value === "gif" || value === "video";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasRecentLayoutStickerGrace(options) {
  return (
    options.hasLastUsableWarpWindow === true &&
    typeof options.now === "number" &&
    typeof options.layoutStickerUntil === "number" &&
    options.layoutStickerUntil > 0 &&
    options.now <= options.layoutStickerUntil
  );
}

function fullWarpOverlayBounds(bounds) {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  };
}

function comboStagePositionWithinFullWarp(bounds, options) {
  return {
    left: Math.round(bounds.width - options.width - options.margin + options.width / 2),
    top: Math.round(options.margin + options.height / 2)
  };
}

module.exports = {
  buildPackagedDaemonSpawnEnv,
  comboStagePositionWithinFullWarp,
  comboTriggerIdFromPromptEvent,
  extractNewStickerCommands,
  fullWarpOverlayBounds,
  hasRecentLayoutStickerGrace,
  hasRecentStickerGrace,
  hasUsableWarpBounds
};
