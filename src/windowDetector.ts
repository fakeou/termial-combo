import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Bounds, ContextEvent } from "./types.js";

export interface ActiveWindowInfo {
  appName: string;
  bundleId?: string;
  pid?: number;
  title?: string;
  bounds?: Bounds;
}

export function isWarpWindow(info: Pick<ActiveWindowInfo, "appName" | "bundleId">): boolean {
  return /warp/i.test(info.appName) || /dev\.warp\./i.test(info.bundleId ?? "");
}

export async function getActiveWindowInfo(): Promise<ActiveWindowInfo | undefined> {
  const result = await getMacActiveWindow();
  if (!result) return undefined;
  const owner = result.owner;
  const bounds = boundsFromUnknown(result.bounds);

  return {
    appName: owner?.name ?? "unknown",
    bundleId: owner?.bundleId,
    pid: owner?.processId,
    title: result.title,
    bounds
  };
}

async function getMacActiveWindow(): Promise<
  | {
      owner?: { name?: string; bundleId?: string; processId?: number };
      title?: string;
      bounds?: { x?: number; y?: number; width?: number; height?: number };
    }
  | undefined
> {
  const require = createRequire(import.meta.url);
  const activeWinEntryPath = require.resolve("active-win");
  const activeWinModuleUrl = activeWinMacosModuleUrl(activeWinEntryPath);
  const { activeWindow } = await import(activeWinModuleUrl);
  return activeWindow(activeWinQueryOptions());
}

export function activeWinMacosModuleUrl(activeWinEntryPath: string): string {
  return pathToFileURL(join(dirname(activeWinEntryPath), "lib", "macos.js")).href;
}

export function activeWinQueryOptions(): { accessibilityPermission: false; screenRecordingPermission: false } {
  return {
    accessibilityPermission: false,
    screenRecordingPermission: false
  };
}

function boundsFromUnknown(input: { x?: number; y?: number; width?: number; height?: number } | undefined): Bounds | undefined {
  if (!input) return undefined;

  if (
    typeof input.x !== "number" ||
    typeof input.y !== "number" ||
    typeof input.width !== "number" ||
    typeof input.height !== "number"
  ) {
    return undefined;
  }

  return {
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height
  };
}

export function toWindowEvents(
  previous: ActiveWindowInfo | undefined,
  current: ActiveWindowInfo,
  source: string
): Omit<ContextEvent, "timestamp">[] {
  const events: Omit<ContextEvent, "timestamp">[] = [];
  const appChanged = !previous || previous.appName !== current.appName || previous.bundleId !== current.bundleId || previous.pid !== current.pid;
  const windowChanged =
    appChanged ||
    previous?.title !== current.title ||
    JSON.stringify(previous?.bounds) !== JSON.stringify(current.bounds);

  if (appChanged) {
    events.push({
      type: "active_app_changed",
      source,
      metadata: metadataForWindow(current)
    });
  }

  if (windowChanged) {
    events.push({
      type: "active_window_changed",
      source,
      metadata: metadataForWindow(current)
    });
  }

  if (isWarpWindow(current) && (appChanged || windowChanged)) {
    events.push({
      type: "warp_window_detected",
      source,
      metadata: metadataForWindow(current)
    });
  }

  return events;
}

function metadataForWindow(info: ActiveWindowInfo): Record<string, unknown> {
  return {
    appName: info.appName,
    bundleId: info.bundleId,
    pid: info.pid,
    title: info.title,
    bounds: info.bounds
  };
}
