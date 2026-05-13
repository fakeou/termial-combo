import electron from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getActiveWindowInfo } from "../windowDetector.js";
import { isWarpWindow } from "../windowDetector.js";
import { computeOverlayBounds } from "../overlay/position.js";
import { ContextEvent, Bounds } from "../types.js";

const { app, BrowserWindow } = electron;

const overlaySize = { width: 72, height: 72, margin: 12 };
const pollMs = Number(process.env.OVERLAY_POLL_MS ?? "250");
const rendererUrl = process.env.OVERLAY_RENDERER_URL ?? "http://127.0.0.1:5173";
const daemonEventsUrl = process.env.OVERLAY_EVENTS_URL ?? "http://127.0.0.1:39877/events";
const forceLastWarp = process.env.OVERLAY_FORCE_WARP === "1";
const statePath = join(process.cwd(), "logs", "overlay-state.json");

let overlayWindow: InstanceType<typeof BrowserWindow> | undefined;
let isPolling = false;
let lastErrorAt = 0;

app.setActivationPolicy("accessory");

await app.whenReady();
await writeOverlayState({ visible: false, reason: "app_ready" });

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
await writeOverlayState({ visible: false, reason: "window_created" });
overlayWindow.loadURL(rendererUrl).catch((error: unknown) => {
  console.error(`[overlay] failed to load renderer: ${error instanceof Error ? error.message : String(error)}`);
});

setTimeout(() => {
  void updateOverlay();
}, 500);
setInterval(() => {
  void updateOverlay();
}, pollMs);

async function updateOverlay(): Promise<void> {
  if (!overlayWindow || overlayWindow.isDestroyed() || isPolling) return;
  isPolling = true;
  try {
    const active = (await getWarpWindowFromDaemon(forceLastWarp)) ?? (await getActiveWindowInfo());
    if (!active || !active.bounds || !isWarpWindow(active)) {
      overlayWindow.hide();
      await writeOverlayState({ visible: false, reason: "not_warp", active });
      return;
    }

    const bounds = computeOverlayBounds(active.bounds, overlaySize);
    if (process.env.OVERLAY_DEBUG === "1") {
      console.log(`[overlay] Warp active: ${JSON.stringify({ active, overlay: bounds })}`);
    }
    overlayWindow.setBounds(bounds, false);
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWindow.showInactive();
    await writeOverlayState({ visible: true, active, overlay: bounds });
  } catch (error) {
    overlayWindow.hide();
    await writeOverlayState({ visible: false, reason: "error", error: error instanceof Error ? error.message : String(error) });
    const now = Date.now();
    if (now - lastErrorAt > 10_000) {
      lastErrorAt = now;
      console.error(`[overlay] active window detection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    isPolling = false;
  }
}

async function writeOverlayState(state: Record<string, unknown>): Promise<void> {
  await mkdir(join(process.cwd(), "logs"), { recursive: true });
  await writeFile(statePath, JSON.stringify({ timestamp: new Date().toISOString(), ...state }, null, 2), "utf8");
}

async function getWarpWindowFromDaemon(useLastWarp: boolean): Promise<{ appName: string; bundleId?: string; pid?: number; title?: string; bounds?: Bounds } | undefined> {
  try {
    const response = await fetch(daemonEventsUrl);
    if (!response.ok) return undefined;
    const payload = await response.json() as { events?: ContextEvent[] };
    const latest = [...(payload.events ?? [])]
      .reverse()
      .find((event) => event.type === "warp_window_detected" || (!useLastWarp && event.type === "active_app_changed"));
    if (!latest || latest.type !== "warp_window_detected") return undefined;
    const metadata = latest.metadata ?? {};
    const bounds = metadata.bounds;
    if (!bounds || typeof bounds !== "object") return undefined;
    return {
      appName: String(metadata.appName ?? "Warp"),
      bundleId: typeof metadata.bundleId === "string" ? metadata.bundleId : undefined,
      pid: typeof metadata.pid === "number" ? metadata.pid : undefined,
      title: typeof metadata.title === "string" ? metadata.title : undefined,
      bounds: bounds as Bounds
    };
  } catch {
    return undefined;
  }
}

app.on("before-quit", () => {
  overlayWindow?.destroy();
});
