const electron = require("electron");
const childProcess = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const { app, BrowserWindow, Menu, Tray, nativeImage } = electron;

const overlaySize = { width: 360, height: 320, margin: -4 };
const pollMs = Number(process.env.OVERLAY_POLL_MS || "100");
const rendererUrl = process.env.OVERLAY_RENDERER_URL || "http://127.0.0.1:5173";
const daemonEventsUrl = process.env.OVERLAY_EVENTS_URL || "http://127.0.0.1:39877/events";
const forceLastWarp = process.env.OVERLAY_FORCE_WARP === "1";
const inputCounterEnabled = process.env.OVERLAY_INPUT_COUNTER === "1";
const initialComboWindowMs = Number(process.env.OVERLAY_COMBO_WINDOW_MS || "2000");
const projectRoot = process.cwd();
const statePath = path.join(projectRoot, "logs", "overlay-state.json");
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
const seenStickerTriggerIds = new Set();
const seenStickerTriggerIdOrder = [];
const maxSeenStickerTriggerIds = 500;

app.setActivationPolicy("accessory");

app.whenReady().then(async () => {
  await writeOverlayState({ visible: false, reason: "app_ready_cjs", inputCounterEnabled });
  createTray();

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
      backgroundThrottling: false
    }
  });

  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  await writeOverlayState({ visible: false, reason: "window_created_cjs" });
  loadRendererWithRetry();
  overlayWindow.webContents.on("did-finish-load", () => {
    sendOverlaySettings().catch(() => {});
    sendComboState(comboCount).catch(() => {});
  });

  setTimeout(() => {
    updateOverlay().catch(() => {});
  }, 500);
  setInterval(() => {
    updateOverlay().catch(() => {});
  }, pollMs);
  if (inputCounterEnabled) {
    startInputActivityHelper();
  }
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

async function updateOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed() || isPolling) return;
  isPolling = true;
  try {
    const events = await getRecentDaemonEvents();
    await forwardStickerCommands(events);
    const active = getWarpWindowFromEvents(events, forceLastWarp);
    if (!active || !active.bounds || !isWarpWindow(active)) {
      overlayWindow.hide();
      currentWarpActive = false;
      comboCount = 0;
      await sendComboState(0);
      await writeOverlayState({ visible: false, reason: "not_warp", active, comboCount });
      return;
    }

    currentWarpActive = true;
    comboCount = valueAt(Date.now());
    const bounds = computeOverlayBounds(active.bounds, overlaySize);
    overlayWindow.setBounds(bounds, false);
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWindow.showInactive();
    await sendComboState(comboCount, { ifChanged: true });
    await writeOverlayState({
      visible: true,
      active,
      overlay: bounds,
      comboCount,
      inputCounterEnabled,
      selectedComboStyle,
      comboWindowMs
    });
    if (process.env.OVERLAY_DEBUG === "1") {
      console.log(`[overlay] visible ${JSON.stringify({ active, overlay: bounds })}`);
    }
  } catch (error) {
    overlayWindow.hide();
    await writeOverlayState({ visible: false, reason: "error", error: messageOf(error) });
  } finally {
    isPolling = false;
  }
}

function startInputActivityHelper() {
  const helperPath = path.join(projectRoot, "scripts", "key-activity.swift");
  writeOverlayState({ visible: Boolean(currentWarpActive), reason: "input_helper_starting", helperPath }).catch(() => {});
  inputHelper = childProcess.spawn("swift", [helperPath], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
  writeOverlayState({ visible: Boolean(currentWarpActive), reason: "input_helper_started", helperPath, pid: inputHelper.pid }).catch(() => {});

  inputHelper.stdout.setEncoding("utf8");
  inputHelper.stdout.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim() === "commit") {
        recordInputActivity().catch(() => {});
      }
    }
  });

  inputHelper.stderr.setEncoding("utf8");
  inputHelper.stderr.on("data", (chunk) => {
    writeOverlayState({ visible: Boolean(currentWarpActive), reason: "input_helper_stderr", error: String(chunk).trim() }).catch(() => {});
  });

  inputHelper.on("exit", (code, signal) => {
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
        label: "样式",
        submenu: comboStyles.map((style) => ({
          label: style.label,
          type: "radio",
          checked: selectedComboStyle === style.id,
          click: () => {
            selectedComboStyle = style.id;
            refreshTrayMenu();
            sendOverlaySettings().catch(() => {});
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
            sendOverlaySettings().catch(() => {});
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
  inputHelper?.kill();
  inputHelper = undefined;
  overlayWindow?.destroy();
  app.quit();
}

async function recordInputActivity() {
  if (!currentWarpActive || !overlayWindow || overlayWindow.isDestroyed()) return;
  const now = Date.now();
  comboCount = valueAt(now) + 1;
  lastInputAt = now;
  await sendComboState(comboCount);
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

async function sendOverlaySettings() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const detail = JSON.stringify({ style: selectedComboStyle, comboWindowMs });
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

async function forwardStickerCommands(events) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const commands = extractNewStickerCommands(events);
  for (const command of commands) {
    const detail = JSON.stringify(command);
    await overlayWindow.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent("sticker-trigger", { detail: ${detail} }))`
    ).catch(() => {});
  }
}

function extractNewStickerCommands(events) {
  const commands = [];

  for (const event of events) {
    const command = stickerCommandFromEvent(event);
    if (command) commands.push(command);
  }

  return commands;
}

function stickerCommandFromEvent(event) {
  if (!event || event.type !== "sticker_triggered" || !isRecord(event.metadata)) return undefined;

  const triggerId = stringValue(event.metadata.triggerId);
  if (!triggerId || seenStickerTriggerIds.has(triggerId)) return undefined;

  const asset = stickerAssetFromUnknown(event.metadata.asset);
  if (!asset) return undefined;

  rememberStickerTriggerId(triggerId);
  const command = {
    triggerId,
    asset,
    durationMs: clampStickerDuration(event.metadata.durationMs)
  };

  const matchedKeyword = stringValue(event.metadata.matchedKeyword);
  if (matchedKeyword) command.matchedKeyword = matchedKeyword;

  const ruleId = stringValue(event.metadata.ruleId);
  if (ruleId) command.ruleId = ruleId;

  return command;
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

function clampStickerDuration(value) {
  const duration = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 2000;
  return Math.min(5000, Math.max(1, duration));
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

async function writeOverlayState(state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify({ timestamp: new Date().toISOString(), ...state }, null, 2), "utf8");
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
