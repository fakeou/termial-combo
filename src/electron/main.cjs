const electron = require("electron");
const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const {
  buildPackagedDaemonSpawnEnv,
  comboTriggerIdFromPromptEvent,
  extractNewStickerCommands: extractNewStickerCommandsFromDaemon,
  fullWarpOverlayBounds,
  hasRecentLayoutStickerGrace,
  hasRecentStickerGrace,
  hasUsableWarpBounds
} = require("./packagedDaemon.cjs");

const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog } = electron;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
  process.exit(0);
}

const overlaySize = { width: 360, height: 320, margin: -4 };
const pollMs = Number(process.env.OVERLAY_POLL_MS || "100");
const daemonEventsUrl = process.env.OVERLAY_EVENTS_URL || "http://127.0.0.1:39877/events";
const daemonCodexScanUrl = process.env.OVERLAY_CODEX_SCAN_URL || codexScanUrlFromEventsUrl(daemonEventsUrl);
const forceLastWarp = process.env.OVERLAY_FORCE_WARP === "1";
const inputCounterEnabled = process.env.OVERLAY_INPUT_COUNTER !== "0";
const codexScanOnEnterEnabled = process.env.OVERLAY_CODEX_SCAN_ON_ENTER !== "0";
const initialComboWindowMs = Number(process.env.OVERLAY_COMBO_WINDOW_MS || "2000");
const packagedAppRoot = path.join(app.getAppPath(), "resources");
const projectRoot = app.isPackaged ? packagedAppRoot : process.cwd();
const rendererUrl = process.env.OVERLAY_RENDERER_URL || (app.isPackaged
  ? pathToFileURL(path.join(projectRoot, "dist", "renderer", "index.html")).toString()
  : "http://127.0.0.1:5173");
const disableRendererWebSecurity = /^https?:\/\//i.test(rendererUrl);
const statePath = path.join(projectRoot, "logs", "overlay-state.json");
const mainLogPath = path.join(projectRoot, "logs", "main.log");
const comboStyles = [
  { id: "arcade", label: "DNF Arcade" },
  { id: "neon", label: "Neon Blade" },
  { id: "gold", label: "Gold Burst" }
];
const comboWindowOptions = [
  { label: "1.5 秒", value: 1500 },
  { label: "2 秒", value: 2000 },
  { label: "2.5 秒", value: 2500 },
  { label: "3 秒", value: 3000 }
];

let overlayWindow;
let settingsWindow;
let keeperWindow;
let tray;
let inputHelper;
let isPolling = false;
let currentWarpActive = false;
let comboCount = 0;
let lastInputAt = 0;
let lastSentComboCount = undefined;
let lastSentComboStartedAt = undefined;
let lastSentComboWindowMs = undefined;
let selectedComboStyle = "arcade";
let comboWindowMs = initialComboWindowMs;
let lastCodexScanErrorAt = 0;
let daemonProcess;
let lastUsableWarpWindow;
let lastStickerAt = 0;
let layoutStickerUntil = 0;
const stickerGraceMs = 5000;
const seenStickerTriggerIds = new Set();
const seenStickerTriggerIdOrder = [];
const maxSeenStickerTriggerIds = 500;
const seenComboTriggerIds = new Set();
const seenComboTriggerIdOrder = [];
const maxSeenComboTriggerIds = 500;

app.setActivationPolicy("accessory");
process.on("uncaughtException", (error) => {
  logMain(`uncaughtException ${messageOf(error)}`);
});
process.on("unhandledRejection", (error) => {
  logMain(`unhandledRejection ${messageOf(error)}`);
});

app.on("second-instance", () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.showInactive();
  }
});

app.whenReady().then(async () => {
  logMain(`ready packaged=${app.isPackaged} root=${projectRoot} renderer=${rendererUrl}`);
  await writeOverlayState({ visible: false, reason: "app_ready_cjs", inputCounterEnabled, codexScanOnEnterEnabled });
  startPackagedDaemon();
  createTray();
  keeperWindow = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    frame: false,
    webPreferences: {
      backgroundThrottling: false
    }
  });

  overlayWindow = new BrowserWindow({
    width: overlaySize.width,
    height: overlaySize.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      backgroundThrottling: false,
      webSecurity: !disableRendererWebSecurity
    }
  });

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  await writeOverlayState({ visible: false, reason: "window_created_cjs" });
  loadRendererWithRetry();
  overlayWindow.webContents.on("did-finish-load", () => {
    sendOverlayConfig().catch(() => {});
    sendComboState(comboCount).catch(() => {});
  });

  setTimeout(() => {
    updateOverlay().catch(() => {});
  }, 500);
  setInterval(() => {
    updateOverlay().catch(() => {});
  }, pollMs);
  if (inputCounterEnabled || codexScanOnEnterEnabled) {
    startInputActivityHelper();
  }
  registerSettingsIpc();
});

function loadRendererWithRetry(attempt = 1) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.loadURL(rendererUrl).catch((error) => {
    writeOverlayState({ visible: false, reason: "renderer_load_error", attempt, error: messageOf(error) }).catch(() => {});
    if (attempt < 20) {
      setTimeout(() => loadRendererWithRetry(attempt + 1), 250);
    }
  });
}

function settingsUrl() {
  const url = new URL(rendererUrl);
  url.searchParams.set("view", "settings");
  return url.toString();
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 980,
    minHeight: 660,
    title: "Termial Combo",
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: !disableRendererWebSecurity
    }
  });

  settingsWindow.loadURL(settingsUrl()).catch((error) => {
    logMain(`settings renderer load failed ${messageOf(error)}`);
  });
  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
  });
  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
  });
}

function registerSettingsIpc() {
  ipcMain.handle("termial:get-config", async () => {
    const response = await fetch(configUrlFromEventsUrl(daemonEventsUrl));
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const payload = await response.json();
    return payload.config;
  });

  ipcMain.handle("termial:save-config", async (_event, config) => {
    const response = await fetch(configUrlFromEventsUrl(daemonEventsUrl), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const payload = await response.json();
    await sendOverlayConfig(payload.config);
    return payload.config;
  });

  ipcMain.handle("termial:choose-asset", async () => {
    const result = await dialog.showOpenDialog(settingsWindow, {
      properties: ["openFile"],
      filters: [
        { name: "Sticker media", extensions: ["png", "jpg", "jpeg", "webp", "avif", "gif", "mp4", "webm", "mov"] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return undefined;
    const filePath = result.filePaths[0];
    const dataBase64 = fsSync.readFileSync(filePath).toString("base64");
    const response = await fetch(assetsUrlFromEventsUrl(daemonEventsUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: path.basename(filePath), dataBase64 })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const payload = await response.json();
    return payload.asset;
  });
}

async function updateOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed() || isPolling) return;
  isPolling = true;
  try {
    const events = await getRecentDaemonEvents();
    await forwardStickerCommands(events);
    const active = getWarpWindowFromEvents(events, forceLastWarp);
    if (!active || !active.bounds || !isWarpWindow(active)) {
      const fallbackActive = recentComboWarpWindow();
      if (fallbackActive) {
        await showOverlayForWarpWindow(fallbackActive, { reason: "combo_grace" });
        return;
      }
      const stickerFallbackActive = recentStickerWarpWindow();
      if (stickerFallbackActive) {
        await showOverlayForWarpWindow(stickerFallbackActive, { reason: "sticker_grace" });
        return;
      }

      overlayWindow.hide();
      currentWarpActive = false;
      comboCount = 0;
      await sendComboState(0);
      await writeOverlayState({ visible: false, reason: "not_warp", active, comboCount });
      return;
    }

    currentWarpActive = true;
    lastUsableWarpWindow = active;
    await recordPromptComboTriggers(events);
    await showOverlayForWarpWindow(active);
  } catch (error) {
    overlayWindow.hide();
    await writeOverlayState({ visible: false, reason: "error", error: messageOf(error) });
  } finally {
    isPolling = false;
  }
}

async function showOverlayForWarpWindow(active, options = {}) {
  currentWarpActive = true;
  comboCount = valueAt(Date.now());
  const useFullWarpBounds = hasRecentLayoutStickerGrace({
    now: Date.now(),
    layoutStickerUntil,
    hasLastUsableWarpWindow: Boolean(lastUsableWarpWindow)
  });
  const bounds = useFullWarpBounds ? fullWarpOverlayBounds(active.bounds) : computeOverlayBounds(active.bounds, overlaySize);
  overlayWindow.setBounds(bounds, false);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.showInactive();
  await sendComboState(comboCount, { ifChanged: true });
  await writeOverlayState({
    visible: true,
    reason: options.reason,
    active,
    overlay: bounds,
    comboCount,
    inputCounterEnabled,
    codexScanOnEnterEnabled,
    selectedComboStyle,
    comboWindowMs,
    overlayMode: useFullWarpBounds ? "full-warp" : "combo"
  });
  if (process.env.OVERLAY_DEBUG === "1") {
    console.log(`[overlay] visible ${JSON.stringify({ active, overlay: bounds })}`);
  }
}

function recentComboWarpWindow() {
  if (!lastUsableWarpWindow || comboCount === 0) return undefined;
  return valueAt(Date.now()) > 0 ? lastUsableWarpWindow : undefined;
}

function recentStickerWarpWindow() {
  return hasRecentStickerGrace({
    now: Date.now(),
    lastStickerAt,
    graceMs: stickerGraceMs,
    hasLastUsableWarpWindow: Boolean(lastUsableWarpWindow)
  })
    ? lastUsableWarpWindow
    : undefined;
}

function startInputActivityHelper() {
  const helperPath = path.join(projectRoot, "scripts", "key-activity.swift");
  const swiftPath = fsSync.existsSync("/usr/bin/swift") ? "/usr/bin/swift" : "swift";
  logMain(`input helper starting command=${swiftPath} path=${helperPath}`);
  writeOverlayState({ visible: Boolean(currentWarpActive), reason: "input_helper_starting", helperPath }).catch(() => {});
  inputHelper = childProcess.spawn(swiftPath, [helperPath], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
  logMain(`input helper started pid=${inputHelper.pid ?? "unknown"}`);
  writeOverlayState({ visible: Boolean(currentWarpActive), reason: "input_helper_started", helperPath, pid: inputHelper.pid }).catch(() => {});

  inputHelper.stdout.setEncoding("utf8");
  inputHelper.stdout.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      const inputEvent = line.trim();
      if (inputEvent) {
        logMain(`input helper event=${inputEvent}`);
      }
      if ((inputEvent === "commit" || inputEvent === "enter") && inputCounterEnabled) {
        recordInputActivity().catch(() => {});
      }
      if (inputEvent === "enter") {
        triggerCodexScanOnEnter().catch(() => {});
      }
    }
  });

  inputHelper.stderr.setEncoding("utf8");
  inputHelper.stderr.on("data", (chunk) => {
    logMain(`input helper stderr=${String(chunk).trim()}`);
    writeOverlayState({ visible: Boolean(currentWarpActive), reason: "input_helper_stderr", error: String(chunk).trim() }).catch(() => {});
  });

  inputHelper.on("error", (error) => {
    logMain(`input helper error=${messageOf(error)}`);
    writeOverlayState({ visible: Boolean(currentWarpActive), reason: "input_helper_error", error: messageOf(error) }).catch(() => {});
    inputHelper = undefined;
  });

  inputHelper.on("exit", (code, signal) => {
    logMain(`input helper exit code=${code} signal=${signal}`);
    writeOverlayState({ visible: Boolean(currentWarpActive), reason: "input_helper_exit", code, signal }).catch(() => {});
    inputHelper = undefined;
  });
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAQElEQVR4nGNgGPTgPxGAYgOobhBeA4m1kSKDCHqHGINIMoTmBpFsCE0NIssQmF9E4k4nIv1hAIoNItkLXZkUAADivT+OM47jQAAAAABJRU5ErkJggg=="
  );
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setTitle("⚡");
  tray.setToolTip("Warp Combo Overlay");
  refreshTrayMenu();
  tray.on("click", () => {
    tray.popUpContextMenu();
  });
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开编辑器",
        click: () => {
          openSettingsWindow();
        }
      },
      { type: "separator" },
      {
        label: "样式",
        submenu: comboStyles.map((style) => ({
          label: style.label,
          type: "radio",
          checked: selectedComboStyle === style.id,
          click: () => {
            selectedComboStyle = style.id;
            refreshTrayMenu();
            sendOverlayConfig().catch(() => {});
          }
        }))
      },
      {
        label: "连击延续时间",
        submenu: comboWindowOptions.map((option) => ({
          label: option.label,
          type: "radio",
          checked: comboWindowMs === option.value,
          click: () => {
            comboWindowMs = option.value;
            refreshTrayMenu();
            sendOverlayConfig().catch(() => {});
            sendComboState(valueAt(Date.now())).catch(() => {});
          }
        }))
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          quitApp();
        }
      }
    ])
  );
}

function quitApp() {
  logMain("quitApp");
  inputHelper?.kill();
  inputHelper = undefined;
  daemonProcess?.kill();
  daemonProcess = undefined;
  keeperWindow?.destroy();
  keeperWindow = undefined;
  overlayWindow?.destroy();
  app.quit();
}

function startPackagedDaemon() {
  if (!app.isPackaged || process.env.OVERLAY_START_DAEMON === "0") return;

  const daemonPath = path.join(projectRoot, "dist", "app-js", "cli", "daemon.js");
  daemonProcess = childProcess.spawn(process.execPath, [daemonPath], {
    cwd: projectRoot,
    env: buildPackagedDaemonSpawnEnv({
      baseEnv: process.env,
      eventLogPath: path.join(projectRoot, "logs", "events.jsonl"),
      stickerRulesPath: path.join(projectRoot, "config", "sticker-rules.json")
    }),
    stdio: ["ignore", "ignore", "pipe"]
  });
  logMain(`daemon started pid=${daemonProcess.pid} path=${daemonPath}`);

  daemonProcess.stderr.setEncoding("utf8");
  daemonProcess.stderr.on("data", (chunk) => {
    writeOverlayState({ visible: Boolean(currentWarpActive), reason: "daemon_stderr", error: String(chunk).trim() }).catch(() => {});
  });
  daemonProcess.on("exit", (code, signal) => {
    logMain(`daemon exit code=${code} signal=${signal}`);
    writeOverlayState({ visible: Boolean(currentWarpActive), reason: "daemon_exit", code, signal }).catch(() => {});
    daemonProcess = undefined;
  });
}

async function recordInputActivity() {
  if (!currentWarpActive || !overlayWindow || overlayWindow.isDestroyed()) {
    logMain(`combo ignored currentWarpActive=${currentWarpActive} hasOverlay=${Boolean(overlayWindow && !overlayWindow.isDestroyed())}`);
    return;
  }
  const now = Date.now();
  comboCount = valueAt(now) + 1;
  lastInputAt = now;
  logMain(`combo recorded count=${comboCount}`);
  await sendComboState(comboCount);
}

async function recordPromptComboTriggers(events) {
  if (!currentWarpActive || !overlayWindow || overlayWindow.isDestroyed()) return;

  for (const event of events) {
    const triggerId = comboTriggerIdFromPromptEvent(event);
    if (!triggerId || seenComboTriggerIds.has(triggerId)) continue;

    rememberComboTriggerId(triggerId);
    await recordInputActivity();
  }
}

async function triggerCodexScanOnEnter() {
  if (!codexScanOnEnterEnabled || !currentWarpActive) return;

  try {
    const response = await fetch(daemonCodexScanUrl, { method: "POST" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
  } catch (error) {
    const now = Date.now();
    if (now - lastCodexScanErrorAt <= 10_000) return;
    lastCodexScanErrorAt = now;
    await writeOverlayState({
      visible: Boolean(currentWarpActive),
      reason: "codex_scan_on_enter_error",
      error: messageOf(error),
      daemonCodexScanUrl
    });
  }
}

function valueAt(now) {
  if (comboCount === 0) return 0;
  return now - lastInputAt <= comboWindowMs ? comboCount : 0;
}

async function sendComboState(count, options = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const startedAt = count > 0 ? lastInputAt : 0;
  if (
    options.ifChanged &&
    count === lastSentComboCount &&
    startedAt === lastSentComboStartedAt &&
    comboWindowMs === lastSentComboWindowMs
  ) {
    return;
  }
  lastSentComboCount = count;
  lastSentComboStartedAt = startedAt;
  lastSentComboWindowMs = comboWindowMs;
  await overlayWindow.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent("combo-count", { detail: { count: ${Number(count) || 0}, startedAt: ${Number(startedAt) || 0}, comboWindowMs: ${comboWindowMs} } }))`
  ).catch(() => {});
}

async function sendOverlayConfig(config) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  let overlayConfig = config;
  try {
    if (!overlayConfig) {
      const response = await fetch(configUrlFromEventsUrl(daemonEventsUrl));
      if (!response.ok) return;
      const payload = await response.json();
      overlayConfig = payload.config;
    }
    const comboConfig = overlayConfig?.combo;
    if (comboConfig && typeof comboConfig.comboWindowMs === "number") {
      comboWindowMs = comboConfig.comboWindowMs;
    }
    if (comboConfig && typeof comboConfig.style === "string" && comboConfig.style !== "custom") {
      selectedComboStyle = comboConfig.style;
    }
  } catch {
    // The overlay can run with menu-only settings while the daemon starts.
  }
  const detail = JSON.stringify({ style: selectedComboStyle, comboWindowMs, combo: overlayConfig?.combo, config: overlayConfig });
  await overlayWindow.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent("combo-settings", { detail: ${detail} }))`
  ).catch(() => {});
}

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

function getWarpWindowFromEvents(events, useLastWarp) {
  const latest = [...events]
    .reverse()
    .find((event) => {
      if (event.type !== "warp_window_detected" && (useLastWarp || event.type !== "active_app_changed")) {
        return false;
      }

      return hasUsableWarpBounds(event.metadata?.bounds);
    });
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

async function forwardStickerCommands(events) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const commands = extractNewStickerCommands(events);
  for (const command of commands) {
    lastStickerAt = Date.now();
    if (command.layout) {
      layoutStickerUntil = Math.max(layoutStickerUntil, lastStickerAt + (command.durationMs || 2000) + 500);
    }
    const detail = JSON.stringify(command);
    await overlayWindow.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent("sticker-trigger", { detail: ${detail} }))`
    ).catch(() => {});
  }
}

function extractNewStickerCommands(events) {
  const commands = extractNewStickerCommandsFromDaemon(events, seenStickerTriggerIds);
  for (const command of commands) {
    rememberStickerTriggerId(command.triggerId);
  }
  return commands;
}

function rememberStickerTriggerId(triggerId) {
  if (seenStickerTriggerIds.has(triggerId)) return;

  seenStickerTriggerIds.add(triggerId);
  seenStickerTriggerIdOrder.push(triggerId);

  while (seenStickerTriggerIdOrder.length > maxSeenStickerTriggerIds) {
    const oldestTriggerId = seenStickerTriggerIdOrder.shift();
    if (oldestTriggerId !== undefined) {
      seenStickerTriggerIds.delete(oldestTriggerId);
    }
  }
}

function rememberComboTriggerId(triggerId) {
  if (seenComboTriggerIds.has(triggerId)) return;

  seenComboTriggerIds.add(triggerId);
  seenComboTriggerIdOrder.push(triggerId);

  while (seenComboTriggerIdOrder.length > maxSeenComboTriggerIds) {
    const oldestTriggerId = seenComboTriggerIdOrder.shift();
    if (oldestTriggerId !== undefined) {
      seenComboTriggerIds.delete(oldestTriggerId);
    }
  }
}

function isWarpWindow(info) {
  return /warp/i.test(info.appName || "") || /dev\.warp\./i.test(info.bundleId || "");
}

function computeOverlayBounds(windowBounds, options) {
  return {
    x: Math.round(windowBounds.x + windowBounds.width - options.width - options.margin),
    y: Math.round(windowBounds.y + options.margin),
    width: options.width,
    height: options.height
  };
}

function codexScanUrlFromEventsUrl(eventsUrl) {
  try {
    const url = new URL(eventsUrl);
    url.pathname = "/codex/scan";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "http://127.0.0.1:39877/codex/scan";
  }
}

function configUrlFromEventsUrl(eventsUrl) {
  try {
    const url = new URL(eventsUrl);
    url.pathname = "/config";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "http://127.0.0.1:39877/config";
  }
}

function assetsUrlFromEventsUrl(eventsUrl) {
  try {
    const url = new URL(eventsUrl);
    url.pathname = "/assets";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "http://127.0.0.1:39877/assets";
  }
}

async function writeOverlayState(state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify({ timestamp: new Date().toISOString(), ...state }, null, 2), "utf8");
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function pathToFileURL(filePath) {
  let resolved = path.resolve(filePath).replace(/\\/g, "/");
  if (!resolved.startsWith("/")) resolved = `/${resolved}`;
  return new URL(`file://${resolved}`);
}

function logMain(message) {
  try {
    fsSync.mkdirSync(path.dirname(mainLogPath), { recursive: true });
    fsSync.appendFileSync(mainLogPath, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // Logging must not affect overlay startup.
  }
}
