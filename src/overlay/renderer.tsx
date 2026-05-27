import React from "react";
import { createRoot } from "react-dom/client";
import confetti from "canvas-confetti";
import { Rnd } from "react-rnd";
import { comboThemeForCount } from "./comboTheme.js";
import { comboStageStyle, ComboStagePosition } from "./comboStageStyle.js";
import { comboVisualState } from "./comboVisualState.js";
import { keywordsToDraft, parseKeywordDraft } from "./keywordInput.js";
import { canvasRectToLayout, layoutToCanvasRect, presetStickerLayout } from "./layoutCanvas.js";
import { stickerTimingForDuration } from "./stickerTiming.js";
import { clampStickerLayout, defaultStickerLayout, StickerLayout, StickerLayoutFit } from "../stickerLayout.js";
import "./style.css";

const defaultComboWindowMs = 2000;
const defaultComboStyle = "arcade";
const sssThreshold = 50;
const defaultComboDesign = {
  style: "arcade",
  comboWindowMs: defaultComboWindowMs,
  counter: {
    label: "COMBO",
    subLabel: "HIT",
    numberColor: "#f4fdff",
    textColor: "#9ee8ff",
    accentColor: "#36b6ff",
    fontSize: 58,
    scale: 1,
    skewDeg: -8
  },
  background: { enabled: true, style: "speed-lines", opacity: 1 },
  animation: { enter: "pop", hit: "shake", exit: "fade", fadeOutMs: 420 }
};

type StickerAsset =
  | { type: "emoji"; value: string }
  | { type: "image"; url: string }
  | { type: "gif"; url: string }
  | { type: "video"; url: string };

interface StickerDisplay {
  triggerId: string;
  asset: StickerAsset;
  assets: StickerAsset[];
  displayMode: "single" | "cycle";
  cycleIntervalMs: number;
  durationMs: number;
  exiting: boolean;
  exitMs: number;
  layout?: StickerLayout;
}

interface StickerTriggerDetail {
  triggerId: string;
  asset: StickerAsset;
  assets?: StickerAsset[];
  displayMode?: "single" | "cycle";
  cycleIntervalMs?: number;
  durationMs?: number;
  layout?: StickerLayout;
}

type AppConfig = {
  combo: typeof defaultComboDesign;
  rules: Array<{
    id: string;
    enabled?: boolean;
    keywords: string[];
    asset?: StickerAsset & { path?: string };
    assets?: Array<StickerAsset & { path?: string }>;
    displayMode?: "single" | "cycle";
    cycleIntervalMs?: number;
    durationMs: number;
    layout?: StickerLayout;
  }>;
};

function OverlayBadge(): React.ReactElement {
  const fireworkCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const stickerTimeoutRef = React.useRef<number | undefined>(undefined);
  const stickerRemovalTimeoutRef = React.useRef<number | undefined>(undefined);
  const previousCountRef = React.useRef(0);
  const sssArmedRef = React.useRef(true);
  const [fireworksActive, setFireworksActive] = React.useState(false);
  const [comboStyle, setComboStyle] = React.useState(defaultComboStyle);
  const [comboDesign, setComboDesign] = React.useState(defaultComboDesign);
  const [sticker, setSticker] = React.useState<StickerDisplay | undefined>(undefined);
  const [stickerCycleIndex, setStickerCycleIndex] = React.useState(0);
  const [combo, setCombo] = React.useState({
    count: 0,
    startedAt: 0,
    comboWindowMs: defaultComboWindowMs,
    hitNonce: 0
  });
  const [comboStagePosition, setComboStagePosition] = React.useState<ComboStagePosition | undefined>(undefined);
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
      if (isComboDesign(detail?.combo)) {
        setComboDesign(detail.combo);
        setComboStyle(detail.combo.style);
      }
      if (typeof detail?.comboWindowMs === "number") {
        setCombo((previous) => ({ ...previous, comboWindowMs: detail.comboWindowMs ?? previous.comboWindowMs }));
      }
    };
    window.addEventListener("combo-settings", listener);
    return () => window.removeEventListener("combo-settings", listener);
  }, []);

  React.useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      setComboStagePosition(comboStagePositionFromDetail(detail));
    };
    window.addEventListener("overlay-geometry", listener);
    return () => window.removeEventListener("overlay-geometry", listener);
  }, []);

  React.useEffect(() => {
    const clearStickerTimeout = () => {
      if (stickerTimeoutRef.current === undefined) return;
      window.clearTimeout(stickerTimeoutRef.current);
      stickerTimeoutRef.current = undefined;
    };
    const clearStickerRemovalTimeout = () => {
      if (stickerRemovalTimeoutRef.current === undefined) return;
      window.clearTimeout(stickerRemovalTimeoutRef.current);
      stickerRemovalTimeoutRef.current = undefined;
    };
    const clearStickerTimers = () => {
      clearStickerTimeout();
      clearStickerRemovalTimeout();
    };

    const listener = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isStickerTriggerDetail(detail)) return;

      clearStickerTimers();
      const durationMs = clampStickerDuration(detail.durationMs);
      const timing = stickerTimingForDuration(durationMs);
      setStickerCycleIndex(0);
      const assets = detail.assets?.filter(isStickerAsset) ?? [detail.asset];
      setSticker({
        triggerId: detail.triggerId,
        asset: detail.asset,
        assets: assets.length > 0 ? assets : [detail.asset],
        displayMode: detail.displayMode === "cycle" && assets.length > 1 ? "cycle" : "single",
        cycleIntervalMs: clampCycleInterval(detail.cycleIntervalMs),
        durationMs,
        exiting: false,
        exitMs: timing.exitMs,
        layout: isStickerLayout(detail.layout) ? clampStickerLayout(detail.layout) : undefined
      });
      stickerTimeoutRef.current = window.setTimeout(() => {
        stickerTimeoutRef.current = undefined;
        setSticker((current) =>
          current?.triggerId === detail.triggerId ? { ...current, exiting: true } : current
        );
        stickerRemovalTimeoutRef.current = window.setTimeout(() => {
          stickerRemovalTimeoutRef.current = undefined;
          setSticker((current) => (current?.triggerId === detail.triggerId ? undefined : current));
        }, timing.exitMs);
      }, timing.visibleMs);
    };

    window.addEventListener("sticker-trigger", listener);
    return () => {
      window.removeEventListener("sticker-trigger", listener);
      clearStickerTimers();
    };
  }, []);

  React.useEffect(() => {
    if (!sticker || sticker.displayMode !== "cycle" || sticker.assets.length < 2) return;
    const interval = window.setInterval(() => {
      setStickerCycleIndex((current) => (current + 1) % sticker.assets.length);
    }, sticker.cycleIntervalMs);
    return () => window.clearInterval(interval);
  }, [sticker]);

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
    `combo-bg-${comboDesign.background.enabled ? comboDesign.background.style : "none"}`,
    `combo-hit-${comboDesign.animation.hit}`,
    visual.visible ? "" : "is-hidden"
  ].filter(Boolean).join(" ");
  const activeStickerAsset = sticker ? sticker.assets[stickerCycleIndex % sticker.assets.length] ?? sticker.asset : undefined;

  return (
    <main
      className={rootClassName}
      style={comboDesignStyle(comboDesign)}
      aria-label="Warp combo overlay"
    >
      <canvas ref={fireworkCanvasRef} className="sss-fireworks" aria-hidden="true" />
      {visual.visible && (
        <section className="combo-stage" style={comboStageStyle(visual.opacity, comboStagePosition)}>
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
              <span className="combo-label">{comboDesign.counter.label}</span>
              <span className="combo-sub">{comboDesign.counter.subLabel}</span>
            </span>
          </div>
          <div className="rank-badge" key={`rank-${combo.hitNonce}`}>
            <span>{theme.rank}</span>
          </div>
        </section>
      )}
      {sticker ? (
        <section
          className={`${sticker.layout ? "layout-sticker-stage" : "sticker-stage"}${sticker.exiting ? " is-exiting" : ""}`}
          key={sticker.triggerId}
          style={stickerStyle(sticker)}
          aria-hidden="true"
        >
          {activeStickerAsset?.type === "emoji" ? (
            <span className="sticker-emoji">{activeStickerAsset.value}</span>
          ) : activeStickerAsset?.type === "video" ? (
            <video
              className="sticker-media"
              style={sticker.layout ? { objectFit: sticker.layout.fit } : undefined}
              src={activeStickerAsset.url}
              muted
              autoPlay
              loop
              playsInline
              onError={() => {
                if (stickerTimeoutRef.current !== undefined) window.clearTimeout(stickerTimeoutRef.current);
                if (stickerRemovalTimeoutRef.current !== undefined) window.clearTimeout(stickerRemovalTimeoutRef.current);
                stickerTimeoutRef.current = undefined;
                stickerRemovalTimeoutRef.current = undefined;
                setSticker(undefined);
              }}
            />
          ) : (
            <img
              className="sticker-media"
              style={sticker.layout ? { objectFit: sticker.layout.fit } : undefined}
              src={activeStickerAsset?.url}
              alt=""
              onError={() => {
                if (stickerTimeoutRef.current !== undefined) window.clearTimeout(stickerTimeoutRef.current);
                if (stickerRemovalTimeoutRef.current !== undefined) window.clearTimeout(stickerRemovalTimeoutRef.current);
                stickerTimeoutRef.current = undefined;
                stickerRemovalTimeoutRef.current = undefined;
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

function SettingsApp(): React.ReactElement {
  const [config, setConfig] = React.useState<AppConfig | undefined>(undefined);
  const [status, setStatus] = React.useState("加载中");
  const [previewCount, setPreviewCount] = React.useState(27);

  React.useEffect(() => {
    document.documentElement.classList.add("settings-mode");
    document.body.classList.add("settings-mode");
    document.body.classList.remove("overlay-mode");
    loadConfig().then((loaded) => {
      setConfig(loaded);
      setStatus("已加载");
    }).catch((error) => setStatus(messageOf(error)));

    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ config?: unknown }>).detail;
      if (isAppConfig(detail?.config)) {
        setConfig(detail.config);
        setStatus("已同步");
      }
    };
    window.addEventListener("combo-settings", listener);
    return () => window.removeEventListener("combo-settings", listener);
  }, []);

  if (!config) {
    return <main className="settings-shell"><p>{status}</p></main>;
  }

  const updateCombo = (patch: Partial<AppConfig["combo"]>) => {
    setConfig({ ...config, combo: { ...config.combo, ...patch } });
  };
  const updateCounter = (patch: Partial<AppConfig["combo"]["counter"]>) => {
    updateCombo({ counter: { ...config.combo.counter, ...patch } });
  };
  const updateBackground = (patch: Partial<AppConfig["combo"]["background"]>) => {
    updateCombo({ background: { ...config.combo.background, ...patch } });
  };
  const updateAnimation = (patch: Partial<AppConfig["combo"]["animation"]>) => {
    updateCombo({ animation: { ...config.combo.animation, ...patch } });
  };
  const updateRule = (index: number, patch: Partial<AppConfig["rules"][number]>) => {
    const rules = [...config.rules];
    rules[index] = { ...rules[index], ...patch };
    setConfig({ ...config, rules });
  };
  const save = async () => {
    setStatus("保存中");
    try {
      const saved = await saveConfig(config);
      setConfig(saved);
      setStatus("已保存");
    } catch (error) {
      setStatus(messageOf(error));
    }
  };

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <div>
          <h1>Termial Combo</h1>
          <p>编辑 Combo 外观、预览效果，并配置 prompt 关键词触发的贴纸规则。</p>
        </div>
        <button className="primary-button" onClick={save}>保存配置</button>
      </header>
      <div className="settings-status">{status}</div>
      <section className="settings-grid">
        <div className="settings-panel">
          <h2>Combo 效果</h2>
          <label>
            样式
            <select value={config.combo.style} onChange={(event) => updateCombo({ style: event.target.value as AppConfig["combo"]["style"] })}>
              <option value="arcade">DNF Arcade</option>
              <option value="neon">Neon Blade</option>
              <option value="gold">Gold Burst</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <div className="form-row">
            <label>
              主文字
              <input value={config.combo.counter.label} onChange={(event) => updateCounter({ label: event.target.value })} />
            </label>
            <label>
              副文字
              <input value={config.combo.counter.subLabel} onChange={(event) => updateCounter({ subLabel: event.target.value })} />
            </label>
          </div>
          <div className="form-row">
            <label>
              数字颜色
              <input type="color" value={config.combo.counter.numberColor} onChange={(event) => updateCounter({ numberColor: event.target.value })} />
            </label>
            <label>
              文字颜色
              <input type="color" value={config.combo.counter.textColor} onChange={(event) => updateCounter({ textColor: event.target.value })} />
            </label>
            <label>
              强调色
              <input type="color" value={config.combo.counter.accentColor} onChange={(event) => updateCounter({ accentColor: event.target.value })} />
            </label>
          </div>
          <label>
            字号 {Math.round(config.combo.counter.fontSize)}
            <input type="range" min="32" max="72" value={config.combo.counter.fontSize} onChange={(event) => updateCounter({ fontSize: Number(event.target.value) })} />
          </label>
          <label>
            缩放 {config.combo.counter.scale.toFixed(1)}
            <input type="range" min="0.7" max="1.5" step="0.1" value={config.combo.counter.scale} onChange={(event) => updateCounter({ scale: Number(event.target.value) })} />
          </label>
          <div className="form-row">
            <label>
              背景元素
              <select value={config.combo.background.style} onChange={(event) => updateBackground({ style: event.target.value as AppConfig["combo"]["background"]["style"], enabled: event.target.value !== "none" })}>
                <option value="none">无</option>
                <option value="speed-lines">速度线</option>
                <option value="sparks">火花</option>
                <option value="burst">冲击闪光</option>
              </select>
            </label>
            <label>
              透明度
              <input type="range" min="0" max="1" step="0.05" value={config.combo.background.opacity} onChange={(event) => updateBackground({ opacity: Number(event.target.value) })} />
            </label>
          </div>
          <div className="form-row">
            <label>
              入场
              <select value={config.combo.animation.enter} onChange={(event) => updateAnimation({ enter: event.target.value as AppConfig["combo"]["animation"]["enter"] })}>
                <option value="pop">弹出</option>
                <option value="slide">滑入</option>
                <option value="fade">渐入</option>
              </select>
            </label>
            <label>
              命中
              <select value={config.combo.animation.hit} onChange={(event) => updateAnimation({ hit: event.target.value as AppConfig["combo"]["animation"]["hit"] })}>
                <option value="shake">震动</option>
                <option value="pulse">脉冲</option>
                <option value="none">无</option>
              </select>
            </label>
            <label>
              渐出时长
              <input type="number" min="120" max="2000" value={config.combo.animation.fadeOutMs} onChange={(event) => updateAnimation({ fadeOutMs: Number(event.target.value) })} />
            </label>
          </div>
          <div className="preview-box">
            <button onClick={() => setPreviewCount((count) => (count >= 58 ? 7 : count + 13))}>触发预览</button>
            <ComboPreview combo={config.combo} count={previewCount} />
          </div>
        </div>
        <div className="settings-panel">
          <div className="panel-title-row">
            <h2>规则配置器</h2>
            <button onClick={() => setConfig({ ...config, rules: [...config.rules, newRule()] })}>新增规则</button>
          </div>
          <div className="rules-list">
            {config.rules.map((rule, index) => (
              <RuleEditor
                key={`${rule.id}-${index}`}
                rule={rule}
                onChange={(patch) => updateRule(index, patch)}
                onDelete={() => setConfig({ ...config, rules: config.rules.filter((_, ruleIndex) => ruleIndex !== index) })}
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function ComboPreview({ combo, count }: { combo: AppConfig["combo"]; count: number }): React.ReactElement {
  const theme = comboThemeForCount(count);
  return (
    <div className={`preview-stage ${theme.className} combo-style-${combo.style} combo-bg-${combo.background.enabled ? combo.background.style : "none"} combo-hit-${combo.animation.hit}`} style={comboDesignStyle(combo)}>
      <div className="combo-stage" style={{ opacity: 1 }}>
        <div className="speed-lines">{Array.from({ length: 6 }, (_, index) => <span key={index} style={{ "--i": index } as React.CSSProperties} />)}</div>
        <div className="impact-flash" />
        <div className="combo-sparks">{Array.from({ length: 10 }, (_, index) => <span key={index} style={{ "--i": index } as React.CSSProperties} />)}</div>
        <div className="combo-card">
          <span className="combo-number">{count}</span>
          <span className="combo-copy"><span className="combo-label">{combo.counter.label}</span><span className="combo-sub">{combo.counter.subLabel}</span></span>
        </div>
        <div className="rank-badge"><span>{theme.rank}</span></div>
      </div>
    </div>
  );
}

function RuleEditor({ rule, onChange, onDelete }: {
  rule: AppConfig["rules"][number];
  onChange: (patch: Partial<AppConfig["rules"][number]>) => void;
  onDelete: () => void;
}): React.ReactElement {
  const assets = rule.assets?.length ? rule.assets : rule.asset ? [rule.asset] : [];
  const [keywordDraft, setKeywordDraft] = React.useState(() => keywordsToDraft(rule.keywords));
  React.useEffect(() => {
    setKeywordDraft(keywordsToDraft(rule.keywords));
  }, [rule.id]);
  const addEmoji = () => onChange({ assets: [...assets, { type: "emoji", value: "😵" }], asset: assets[0] ?? { type: "emoji", value: "😵" } });
  const upload = async () => {
    const asset = await chooseAsset();
    if (!asset) return;
    const nextAssets = [...assets, asset];
    onChange({ assets: nextAssets, asset: nextAssets[0] });
  };

  return (
    <article className="rule-card">
      <div className="form-row">
        <label>
          ID
          <input value={rule.id} onChange={(event) => onChange({ id: event.target.value })} />
        </label>
        <label>
          显示方式
          <select value={rule.displayMode ?? "single"} onChange={(event) => onChange({ displayMode: event.target.value as "single" | "cycle" })}>
            <option value="single">单个</option>
            <option value="cycle">循环</option>
          </select>
        </label>
        <label>
          时长 ms
          <input type="number" min="1" max="5000" value={rule.durationMs} onChange={(event) => onChange({ durationMs: Number(event.target.value) })} />
        </label>
      </div>
      <label>
        关键词，用逗号分隔
        <input
          value={keywordDraft}
          onChange={(event) => {
            setKeywordDraft(event.target.value);
            onChange({ keywords: parseKeywordDraft(event.target.value) });
          }}
        />
      </label>
      <label>
        循环间隔 ms
        <input type="number" min="250" max="2000" value={rule.cycleIntervalMs ?? 750} onChange={(event) => onChange({ cycleIntervalMs: Number(event.target.value) })} />
      </label>
      <div className="asset-list">
        {assets.map((asset, index) => (
          <div className="asset-pill" key={index}>
            <span>{asset.type === "emoji" ? asset.value : asset.path ?? asset.url}</span>
            <button onClick={() => {
              const nextAssets = assets.filter((_, assetIndex) => assetIndex !== index);
              onChange({ assets: nextAssets, asset: nextAssets[0] });
            }}>移除</button>
          </div>
        ))}
      </div>
      <div className="button-row">
        <button onClick={addEmoji}>添加 Emoji</button>
        <button onClick={upload}>上传素材</button>
        <button className="danger-button" onClick={onDelete}>删除规则</button>
      </div>
      <LayoutCanvasEditor
        asset={assets[0]}
        layout={rule.layout}
        onChange={(layout) => onChange({ layout })}
      />
    </article>
  );
}

function LayoutCanvasEditor({
  asset,
  layout,
  onChange
}: {
  asset?: StickerAsset & { path?: string };
  layout?: StickerLayout;
  onChange: (layout: StickerLayout) => void;
}): React.ReactElement {
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = React.useState({ width: 640, height: 400 });
  const currentLayout = clampStickerLayout(layout ?? defaultStickerLayout);
  const rect = layoutToCanvasRect(currentLayout, canvasSize);
  const [editNonce, setEditNonce] = React.useState(0);

  React.useLayoutEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const updateSize = () => {
      const bounds = element.getBoundingClientRect();
      setCanvasSize({
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height))
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const updateRect = (nextRect: { x: number; y: number; width: number; height: number }) => {
    onChange(canvasRectToLayout(nextRect, canvasSize, { opacity: currentLayout.opacity, fit: currentLayout.fit }));
  };
  const applyPreset = (preset: "fill" | "center" | "top-right" | "reset") => {
    onChange(presetStickerLayout(preset));
    setEditNonce((value) => value + 1);
  };

  return (
    <div className="layout-editor">
      <div className="layout-editor-title">
        <span>展示画布</span>
        <select value={currentLayout.fit} onChange={(event) => onChange({ ...currentLayout, fit: event.target.value as StickerLayoutFit })}>
          <option value="contain">Contain</option>
          <option value="cover">Cover</option>
          <option value="fill">Fill</option>
        </select>
      </div>
      <div className="layout-toolbar">
        <button onClick={() => applyPreset("fill")}>铺满</button>
        <button onClick={() => applyPreset("center")}>居中</button>
        <button onClick={() => applyPreset("top-right")}>右上</button>
        <button onClick={() => applyPreset("reset")}>重置</button>
      </div>
      <label className="opacity-row">
        透明度 {Math.round(currentLayout.opacity * 100)}%
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={currentLayout.opacity}
          onChange={(event) => onChange({ ...currentLayout, opacity: Number(event.target.value) })}
        />
      </label>
      <div className="layout-canvas" ref={canvasRef}>
        <div className="layout-canvas-grid" />
        <Rnd
          key={`${editNonce}-${rect.x}-${rect.y}-${rect.width}-${rect.height}`}
          bounds="parent"
          default={{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }}
          minWidth={Math.max(16, canvasSize.width * 0.05)}
          minHeight={Math.max(16, canvasSize.height * 0.05)}
          enableUserSelectHack={false}
          dragHandleClassName="layout-item"
          resizeHandleStyles={{
            bottomRight: { width: 14, height: 14, right: 2, bottom: 2 },
            bottomLeft: { width: 14, height: 14, left: 2, bottom: 2 },
            topRight: { width: 14, height: 14, right: 2, top: 2 },
            topLeft: { width: 14, height: 14, left: 2, top: 2 }
          }}
          onDragStop={(_event, data) => updateRect({ x: data.x, y: data.y, width: data.node.offsetWidth, height: data.node.offsetHeight })}
          onResizeStop={(_event, _direction, ref, _delta, position) => {
            updateRect({
              x: position.x,
              y: position.y,
              width: ref.offsetWidth,
              height: ref.offsetHeight
            });
          }}
        >
          <div className="layout-item" style={{ opacity: currentLayout.opacity }}>
            <StickerAssetPreview asset={asset} fit={currentLayout.fit} />
          </div>
        </Rnd>
      </div>
    </div>
  );
}

function StickerAssetPreview({ asset, fit }: { asset?: StickerAsset; fit: StickerLayoutFit }): React.ReactElement {
  if (!asset) return <span className="layout-empty">无素材</span>;
  if (asset.type === "emoji") return <span className="layout-emoji">{asset.value}</span>;
  if (asset.type === "video") {
    return (
      <video
        className="layout-media"
        src={asset.url}
        muted
        autoPlay
        loop
        playsInline
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
        style={{ objectFit: fit }}
      />
    );
  }
  return (
    <img
      className="layout-media"
      src={asset.url}
      alt=""
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      style={{ objectFit: fit }}
    />
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
  if (typeof value.triggerId !== "string" || value.triggerId.trim().length === 0) return false;
  if (!isStickerAsset(value.asset)) return false;
  return value.durationMs === undefined || isDurationMs(value.durationMs);
}

function comboDesignStyle(combo: typeof defaultComboDesign): React.CSSProperties {
  return {
    "--combo-number-color": combo.counter.numberColor,
    "--combo-text-color": combo.counter.textColor,
    "--combo-accent-color": combo.counter.accentColor,
    "--combo-font-size": `${combo.counter.fontSize}px`,
    "--combo-scale": String(combo.counter.scale),
    "--combo-skew": `${combo.counter.skewDeg}deg`,
    "--combo-bg-opacity": String(combo.background.opacity),
    "--combo-exit-ms": `${combo.animation.fadeOutMs}ms`
  } as React.CSSProperties;
}

function stickerStyle(sticker: StickerDisplay): React.CSSProperties {
  const base = { "--sticker-exit-ms": `${sticker.exitMs}ms` } as React.CSSProperties;
  if (!sticker.layout) return base;

  return {
    ...base,
    left: `${sticker.layout.x * 100}%`,
    top: `${sticker.layout.y * 100}%`,
    width: `${sticker.layout.width * 100}%`,
    height: `${sticker.layout.height * 100}%`,
    opacity: sticker.layout.opacity
  };
}

function isComboDesign(value: unknown): value is typeof defaultComboDesign {
  return isRecord(value) && isRecord(value.counter) && isRecord(value.background) && isRecord(value.animation);
}

function isAppConfig(value: unknown): value is AppConfig {
  return isRecord(value) && isComboDesign(value.combo) && Array.isArray(value.rules);
}

function comboStagePositionFromDetail(value: unknown): ComboStagePosition | undefined {
  if (!isRecord(value)) return undefined;
  const position = value.comboStage;
  if (!isRecord(position)) return undefined;
  if (typeof position.left !== "number" || !Number.isFinite(position.left)) return undefined;
  if (typeof position.top !== "number" || !Number.isFinite(position.top)) return undefined;
  return { left: position.left, top: position.top };
}

function isStickerLayout(value: unknown): value is StickerLayout {
  return isRecord(value);
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

function clampCycleInterval(value: unknown): number {
  const duration = isDurationMs(value) ? Math.trunc(value) : 750;
  return Math.min(2000, Math.max(250, duration));
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

function newRule(): AppConfig["rules"][number] {
  return {
    id: `rule-${Date.now()}`,
    enabled: true,
    keywords: ["不对"],
    asset: { type: "emoji", value: "😵" },
    assets: [{ type: "emoji", value: "😵" }],
    displayMode: "single",
    cycleIntervalMs: 750,
    durationMs: 2000,
    layout: defaultStickerLayout
  };
}

async function loadConfig(): Promise<AppConfig> {
  const api = settingsApi();
  if (api) return api.invoke("termial:get-config");
  try {
    const response = await fetch("http://127.0.0.1:39877/config");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    return payload.config;
  } catch {
    return {
      combo: { ...defaultComboDesign },
      rules: [
        {
          id: "demo-rule-1",
          enabled: true,
          keywords: ["不对", "报错"],
          asset: { type: "emoji", value: "😵" },
          assets: [{ type: "emoji", value: "😵" }],
          displayMode: "single",
          cycleIntervalMs: 750,
          durationMs: 2000,
          layout: defaultStickerLayout
        }
      ]
    };
  }
}

async function saveConfig(config: AppConfig): Promise<AppConfig> {
  const api = settingsApi();
  if (api) return api.invoke("termial:save-config", config);
  const response = await fetch("http://127.0.0.1:39877/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload.config;
}

async function chooseAsset(): Promise<(StickerAsset & { path?: string }) | undefined> {
  const api = settingsApi();
  if (!api) return undefined;
  return api.invoke("termial:choose-asset");
}

function settingsApi(): { invoke: (channel: string, ...args: unknown[]) => Promise<any> } | undefined {
  const maybeRequire = (globalThis as { require?: unknown }).require;
  if (typeof maybeRequire !== "function") return undefined;
  try {
    return maybeRequire("electron").ipcRenderer;
  } catch {
    return undefined;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const params = new URLSearchParams(window.location.search);
if (params.get("view") === "settings") {
  document.documentElement.classList.add("settings-mode");
  document.body.classList.add("settings-mode");
  createRoot(document.getElementById("root")!).render(<SettingsApp />);
} else {
  document.body.classList.add("overlay-mode");
  createRoot(document.getElementById("root")!).render(<OverlayBadge />);
}
