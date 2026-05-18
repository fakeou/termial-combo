function buildPackagedDaemonSpawnEnv(options) {
  return {
    ...options.baseEnv,
    ELECTRON_RUN_AS_NODE: "1",
    EVENT_LOG_PATH: options.baseEnv.EVENT_LOG_PATH || options.eventLogPath,
    STICKER_RULES_PATH: options.baseEnv.STICKER_RULES_PATH || options.stickerRulesPath
  };
}

module.exports = {
  buildPackagedDaemonSpawnEnv
};
