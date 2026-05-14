import React from "react";
import { createRoot } from "react-dom/client";
import confetti from "canvas-confetti";
import { comboThemeForCount } from "./comboTheme.js";
import { comboVisualState } from "./comboVisualState.js";
import "./style.css";

const defaultComboWindowMs = 2000;
const defaultComboStyle = "arcade";
const sssThreshold = 50;

function OverlayBadge(): React.ReactElement {
  const fireworkCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const previousCountRef = React.useRef(0);
  const sssArmedRef = React.useRef(true);
  const [fireworksActive, setFireworksActive] = React.useState(false);
  const [comboStyle, setComboStyle] = React.useState(defaultComboStyle);
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

createRoot(document.getElementById("root")!).render(<OverlayBadge />);
