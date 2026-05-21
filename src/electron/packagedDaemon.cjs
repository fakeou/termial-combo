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

module.exports = {
  buildPackagedDaemonSpawnEnv,
  comboTriggerIdFromPromptEvent,
  hasRecentStickerGrace,
  hasUsableWarpBounds
};
