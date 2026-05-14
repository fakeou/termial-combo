import React from "react";
import { createRoot } from "react-dom/client";
import confetti from "canvas-confetti";
import { comboThemeForCount } from "./comboTheme.js";
import { comboVisualState } from "./comboVisualState.js";
import "./style.css";

const defaultComboWindowMs = 2000;
const defaultComboStyle = "arcade";
const sssThreshold = 50;

type StickerAsset =
  | { type: "emoji"; value: string }
  | { type: "image"; url: string }
  | { type: "gif"; url: string }
  | { type: "video"; url: string };

interface StickerDisplay {
  asset: StickerAsset;
  durationMs: number;
}

interface StickerTriggerDetail {
  asset: StickerAsset;
  durationMs?: number;
}

function OverlayBadge(): React.ReactElement {
  const fireworkCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const stickerTimeoutRef = React.useRef<number | undefined>(undefined);
  const previousCountRef = React.useRef(0);
  const sssArmedRef = React.useRef(true);
  const [fireworksActive, setFireworksActive] = React.useState(false);
  const [comboStyle, setComboStyle] = React.useState(defaultComboStyle);
  const [sticker, setSticker] = React.useState<StickerDisplay | undefined>(undefined);
  const [combo, setCombo] = React.useState({
    count: 0,
    startedAt: 0,
    comboWindowMs: defaultComboWindowMs,
    hitNonce: 0
  });
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number; startedAt?: number; comboWindowMs?: number }>).detail;
      setCombo((previous) => ({
        count: typeof detail?.count === "number" ? detail.count : 0,
        startedAt: typeof detail?.startedAt === "number" ? detail.startedAt : 0,
        comboWindowMs: typeof detail?.comboWindowMs === "number" ? detail.comboWindowMs : defaultComboWindowMs,
        hitNonce:
          typeof detail?.count === "number" && detail.count > 0 && detail.count !== previous.count
            ? previous.hitNonce + 1
            : previous.hitNonce
      }));
      setNow(Date.now());
    };
    window.addEventListener("combo-count", listener);
    return () => window.removeEventListener("combo-count", listener);
  }, []);

  React.useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ style?: string; comboWindowMs?: number }>).detail;
      if (typeof detail?.style === "string") {
        setComboStyle(detail.style);
      }
      if (typeof detail?.comboWindowMs === "number") {
        setCombo((previous) => ({ ...previous, comboWindowMs: detail.comboWindowMs ?? previous.comboWindowMs }));
      }
    };
    window.addEventListener("combo-settings", listener);
    return () => window.removeEventListener("combo-settings", listener);
  }, []);

  React.useEffect(() => {
    const clearStickerTimeout = () => {
      if (stickerTimeoutRef.current === undefined) return;
      window.clearTimeout(stickerTimeoutRef.current);
      stickerTimeoutRef.current = undefined;
    };

    const listener = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isStickerTriggerDetail(detail)) return;

      clearStickerTimeout();
      const durationMs = clampStickerDuration(detail.durationMs);
      setSticker({ asset: detail.asset, durationMs });
      stickerTimeoutRef.current = window.setTimeout(() => {
        stickerTimeoutRef.current = undefined;
        setSticker(undefined);
      }, durationMs);
    };

    window.addEventListener("sticker-trigger", listener);
    return () => {
      window.removeEventListener("sticker-trigger", listener);
      clearStickerTimeout();
    };
  }, []);

  React.useEffect(() => {
    if (combo.count <= 0) return;
    let frame = 0;
    const tick = () => {
      setNow(Date.now());
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [combo.count, combo.startedAt, combo.comboWindowMs]);

  React.useEffect(() => {
    if (combo.count <= 0) {
      sssArmedRef.current = true;
    }

    if (combo.count >= sssThreshold && previousCountRef.current < sssThreshold && sssArmedRef.current) {
      sssArmedRef.current = false;
      setFireworksActive(true);
      try {
        launchSssFireworks(fireworkCanvasRef.current, () => setFireworksActive(false));
      } catch (error) {
        console.error("[combo-overlay] SSS fireworks failed", error);
        setFireworksActive(false);
      }
    }

    previousCountRef.current = combo.count;
  }, [combo.count]);

  const visual = comboVisualState({
    count: combo.count,
    elapsedMs: combo.startedAt > 0 ? now - combo.startedAt : combo.comboWindowMs + 1,
    comboWindowMs: combo.count >= sssThreshold ? Math.max(combo.comboWindowMs, 3000) : combo.comboWindowMs
  });

  const theme = comboThemeForCount(combo.count);
  const rootClassName = [
    "overlay-root",
    theme.className,
    `combo-style-${comboStyle}`,
    visual.visible ? "" : "is-hidden"
  ].filter(Boolean).join(" ");

  return (
    <main className={rootClassName} aria-label="Warp combo overlay">
      <canvas ref={fireworkCanvasRef} className="sss-fireworks" aria-hidden="true" />
      {visual.visible && (
        <section className="combo-stage" style={{ opacity: visual.opacity }}>
          <div className="speed-lines" key={`lines-${combo.hitNonce}`}>
            {Array.from({ length: 6 }, (_, index) => (
              <span key={index} style={{ "--i": index } as React.CSSProperties} />
            ))}
          </div>
          <div className="impact-flash" key={`flash-${combo.hitNonce}`} />
          <div className="combo-sparks" key={`sparks-${combo.hitNonce}`}>
            {Array.from({ length: 10 }, (_, index) => (
              <span key={index} style={{ "--i": index } as React.CSSProperties} />
            ))}
          </div>
          <div className="combo-card" key={`card-${combo.hitNonce}`}>
            <span className="combo-number">{combo.count}</span>
            <span className="combo-copy">
              <span className="combo-label">COMBO</span>
              <span className="combo-sub">HIT</span>
            </span>
          </div>
          <div className="rank-badge" key={`rank-${combo.hitNonce}`}>
            <span>{theme.rank}</span>
          </div>
        </section>
      )}
      {sticker ? (
        <section className="sticker-stage" aria-hidden="true">
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
              onError={() => {
                if (stickerTimeoutRef.current !== undefined) {
                  window.clearTimeout(stickerTimeoutRef.current);
                  stickerTimeoutRef.current = undefined;
                }
                setSticker(undefined);
              }}
            />
          ) : (
            <img
              className="sticker-media"
              src={sticker.asset.url}
              alt=""
              onError={() => {
                if (stickerTimeoutRef.current !== undefined) {
                  window.clearTimeout(stickerTimeoutRef.current);
                  stickerTimeoutRef.current = undefined;
                }
                setSticker(undefined);
              }}
            />
          )}
        </section>
      ) : null}
      {fireworksActive && <div className="sss-aura" />}
    </main>
  );
}

function launchSssFireworks(canvas: HTMLCanvasElement | null, onDone: () => void): void {
  if (!canvas) {
    onDone();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));

  const fire = confetti.create(canvas, {
    resize: true,
    useWorker: false,
    disableForReducedMotion: true
  });
  const durationMs = 3000;
  const endAt = Date.now() + durationMs;
  window.setTimeout(onDone, durationMs + 400);
  const colors = ["#fff7b0", "#ffd014", "#ff8a00", "#ff3b3b", "#ffffff"];

  const burst = () => {
    try {
      fire({
        particleCount: 28,
        spread: 82,
        startVelocity: 34,
        decay: 0.9,
        scalar: 0.82,
        ticks: 90,
        colors,
        origin: { x: randomBetween(0.18, 0.82), y: randomBetween(0.16, 0.48) }
      });
      fire({
        particleCount: 12,
        spread: 120,
        startVelocity: 18,
        decay: 0.92,
        scalar: 0.48,
        ticks: 130,
        colors,
        origin: { x: 0.5, y: 0.42 }
      });
    } catch (error) {
      console.error("[combo-overlay] SSS fireworks burst failed", error);
      onDone();
      return;
    }

    if (Date.now() < endAt) {
      window.setTimeout(burst, randomBetween(180, 320));
    }
  };

  burst();
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function isStickerTriggerDetail(value: unknown): value is StickerTriggerDetail {
  if (!isRecord(value)) return false;
  if (!isStickerAsset(value.asset)) return false;
  return value.durationMs === undefined || isDurationMs(value.durationMs);
}

function isStickerAsset(value: unknown): value is StickerAsset {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  if (value.type === "emoji") {
    return typeof value.value === "string" && value.value.trim().length > 0;
  }

  if (!isUrlStickerAssetType(value.type)) return false;
  return typeof value.url === "string" && value.url.trim().length > 0;
}

function clampStickerDuration(value: unknown): number {
  const duration = isDurationMs(value) ? Math.trunc(value) : 2000;
  return Math.min(5000, Math.max(1, duration));
}

function isDurationMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUrlStickerAssetType(value: string): value is "image" | "gif" | "video" {
  return value === "image" || value === "gif" || value === "video";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

createRoot(document.getElementById("root")!).render(<OverlayBadge />);
