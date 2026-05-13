import { activeWindow } from "active-win";
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
  const result = await activeWindow();
  if (!result) return undefined;
  const owner = result.owner;
  const bounds = result.bounds
    ? {
        x: result.bounds.x,
        y: result.bounds.y,
        width: result.bounds.width,
        height: result.bounds.height
      }
    : undefined;

  return {
    appName: owner?.name ?? "unknown",
    bundleId: "bundleId" in owner ? owner.bundleId : undefined,
    pid: owner?.processId,
    title: result.title,
    bounds
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
