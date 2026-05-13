import React from "react";
import { createRoot } from "react-dom/client";
import { comboThemeForCount } from "./comboTheme.js";
import { comboVisualState } from "./comboVisualState.js";
import "./style.css";

const defaultComboWindowMs = 2000;

function OverlayBadge(): React.ReactElement {
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
    if (combo.count <= 0) return;
    let frame = 0;
    const tick = () => {
      setNow(Date.now());
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [combo.count, combo.startedAt, combo.comboWindowMs]);

  const visual = comboVisualState({
    count: combo.count,
    elapsedMs: combo.startedAt > 0 ? now - combo.startedAt : combo.comboWindowMs + 1,
    comboWindowMs: combo.comboWindowMs
  });

  if (!visual.visible) {
    return <main className="overlay-root is-hidden" aria-label="Warp combo overlay" />;
  }
  const theme = comboThemeForCount(combo.count);

  return (
    <main className={`overlay-root ${theme.className}`} aria-label="Warp combo overlay" style={{ opacity: visual.opacity }}>
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
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<OverlayBadge />);
