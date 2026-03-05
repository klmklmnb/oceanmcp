import React, { useState, useEffect, useRef, useCallback } from "react";
import OceanMCPSDK from "../main";
import { sdkConfig, THEME, type SupportedLocale, type Theme } from "../runtime/sdk-config";

const btnBase: React.CSSProperties = {
  padding: "8px 0",
  borderRadius: 8,
  border: "none",
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  transition: "opacity 0.15s",
  width: "100%",
};

type PanelColors = {
  bg: string;
  border: string;
  shadow: string;
  title: string;
  label: string;
  codeBg: string;
  inputBg: string;
  inputBorder: string;
  inputText: string;
  resultBg: string;
  resultBorder: string;
  resultText: string;
  selectedBg: string;
  selectedBorder: string;
  selectedText: string;
  unselectedBg: string;
  unselectedBorder: string;
  unselectedText: string;
};

const lightColors: PanelColors = {
  bg: "#fff",
  border: "#e5e7eb",
  shadow: "0 8px 30px rgba(0,0,0,0.12)",
  title: "#374151",
  label: "#6b7280",
  codeBg: "#f3f4f6",
  inputBg: "#fff",
  inputBorder: "#d1d5db",
  inputText: "#374151",
  resultBg: "#f9fafb",
  resultBorder: "#e5e7eb",
  resultText: "#374151",
  selectedBg: "#eff6ff",
  selectedBorder: "#3b82f6",
  selectedText: "#1d4ed8",
  unselectedBg: "#fff",
  unselectedBorder: "#d1d5db",
  unselectedText: "#374151",
};

const darkColors: PanelColors = {
  bg: "#1f2937",
  border: "#374151",
  shadow: "0 8px 30px rgba(0,0,0,0.4)",
  title: "#f9fafb",
  label: "#9ca3af",
  codeBg: "#374151",
  inputBg: "#111827",
  inputBorder: "#4b5563",
  inputText: "#f9fafb",
  resultBg: "#111827",
  resultBorder: "#374151",
  resultText: "#d1d5db",
  selectedBg: "#1e3a5f",
  selectedBorder: "#3b82f6",
  selectedText: "#93c5fd",
  unselectedBg: "#111827",
  unselectedBorder: "#4b5563",
  unselectedText: "#9ca3af",
};

export function TestPanel() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("你好，请介绍一下你自己");
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [locale, setLocale] = useState<SupportedLocale | "">(sdkConfig.locale ?? "zh-CN");
  const [theme, setTheme] = useState<Theme>(sdkConfig.theme ?? THEME.AUTO);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  // ---- Drag-and-drop state for the toggle button ----
  const BUTTON_SIZE = 36;
  const EDGE_MARGIN = 16;

  const [btnPos, setBtnPos] = useState<{ x: number; y: number }>({
    x: window.innerWidth - BUTTON_SIZE - EDGE_MARGIN,
    y: EDGE_MARGIN,
  });
  const draggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  /** Snap the button position to the nearest window edge (left/right/top/bottom). */
  const snapToEdge = useCallback(
    (x: number, y: number): { x: number; y: number } => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cx = x + BUTTON_SIZE / 2;
      const cy = y + BUTTON_SIZE / 2;

      // Distances to each edge
      const dLeft = cx;
      const dRight = vw - cx;
      const dTop = cy;
      const dBottom = vh - cy;
      const minDist = Math.min(dLeft, dRight, dTop, dBottom);

      // Clamp helpers
      const clampX = (v: number) =>
        Math.max(EDGE_MARGIN, Math.min(v, vw - BUTTON_SIZE - EDGE_MARGIN));
      const clampY = (v: number) =>
        Math.max(EDGE_MARGIN, Math.min(v, vh - BUTTON_SIZE - EDGE_MARGIN));

      if (minDist === dLeft) return { x: EDGE_MARGIN, y: clampY(y) };
      if (minDist === dRight) return { x: vw - BUTTON_SIZE - EDGE_MARGIN, y: clampY(y) };
      if (minDist === dTop) return { x: clampX(x), y: EDGE_MARGIN };
      return { x: clampX(x), y: vh - BUTTON_SIZE - EDGE_MARGIN };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      draggingRef.current = true;
      hasDraggedRef.current = false;
      dragOffsetRef.current = {
        x: e.clientX - btnPos.x,
        y: e.clientY - btnPos.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [btnPos],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      hasDraggedRef.current = true;
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;
      setBtnPos({ x: newX, y: newY });
    },
    [],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);

      // Snap to nearest edge with a smooth transition
      const snapped = snapToEdge(btnPos.x, btnPos.y);
      setBtnPos(snapped);
    },
    [btnPos, snapToEdge],
  );

  const handleClick = useCallback(() => {
    // Only toggle if the user didn't drag
    if (!hasDraggedRef.current) {
      setOpen((v) => !v);
    }
  }, []);

  // Keep the button within bounds when the window resizes
  useEffect(() => {
    const onResize = () => {
      setBtnPos((prev) => snapToEdge(prev.x, prev.y));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [snapToEdge]);

  // ---- Compute panel position relative to toggle button ----
  const computePanelStyle = (): React.CSSProperties => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const panelWidth = 320;
    const panelGap = 8;

    // Decide horizontal placement: open toward center
    let left: number;
    if (btnPos.x + BUTTON_SIZE / 2 < vw / 2) {
      // Button is on left half -> panel to the right
      left = btnPos.x;
    } else {
      // Button is on right half -> panel to the left
      left = btnPos.x + BUTTON_SIZE - panelWidth;
    }
    // Clamp so panel stays on-screen
    left = Math.max(EDGE_MARGIN, Math.min(left, vw - panelWidth - EDGE_MARGIN));

    // Decide vertical placement: below or above the button
    let top = btnPos.y + BUTTON_SIZE + panelGap;
    const maxPanelH = vh - 80;
    if (top + maxPanelH > vh - EDGE_MARGIN) {
      // Not enough room below → try above
      top = btnPos.y - panelGap - Math.min(maxPanelH, btnPos.y - EDGE_MARGIN);
      if (top < EDGE_MARGIN) top = EDGE_MARGIN;
    }

    return {
      position: "fixed",
      top,
      left,
      zIndex: 100000,
      width: panelWidth,
      padding: 20,
      borderRadius: 14,
      maxHeight: `calc(100vh - ${top + EDGE_MARGIN}px)`,
      overflow: "auto",
    };
  };

  const isDark =
    theme === THEME.DARK || (theme === THEME.AUTO && systemDark);
  const c = isDark ? darkColors : lightColors;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Sync defaults to sdkConfig on first render
  if (!sdkConfig.locale) {
    sdkConfig.locale = "zh-CN";
  }

  const run = async (label: string, fn: () => Promise<any>) => {
    setLoading(label);
    setResult(null);
    try {
      const res = await fn();
      if (res !== undefined) {
        setResult(JSON.stringify(res, null, 2));
      } else {
        setResult("Done.");
      }
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      {/* Toggle button – draggable, snaps to nearest edge */}
      <button
        ref={btnRef}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          position: "fixed",
          left: btnPos.x,
          top: btnPos.y,
          zIndex: 100000,
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          borderRadius: 10,
          border: "none",
          background: open ? "#ef4444" : "#3b82f6",
          color: "#fff",
          cursor: draggingRef.current ? "grabbing" : "grab",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          transition: draggingRef.current ? "none" : "left 0.3s ease, top 0.3s ease, background 0.15s",
          touchAction: "none",
          userSelect: "none",
        }}
        title="Toggle Test Panel"
      >
        {open ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94L6.73 20.15a2.1 2.1 0 01-3-3l6.79-6.79a6 6 0 017.94-7.94l-3.76 3.88z"/></svg>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          style={{
            ...computePanelStyle(),
            background: c.bg,
            border: `1px solid ${c.border}`,
            boxShadow: c.shadow,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            fontFamily: "system-ui, sans-serif",
            transition: "background 0.2s, border-color 0.2s",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, color: c.title }}>
            SDK Test Panel
          </h3>

          {/* Locale selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={{ margin: 0, fontSize: 11, color: c.label, fontWeight: 500 }}>
              <code style={{ background: c.codeBg, padding: "1px 4px", borderRadius: 3, fontSize: 10, color: c.label }}>locale</code> 模型回复语言
            </p>
            <select
              value={locale}
              onChange={(e) => {
                const v = e.target.value as SupportedLocale | "";
                setLocale(v);
                sdkConfig.locale = v || undefined;
              }}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: `1px solid ${c.inputBorder}`,
                fontSize: 12,
                background: c.inputBg,
                color: c.inputText,
                cursor: "pointer",
              }}
            >
              <option value="">Auto (不指定)</option>
              <option value="zh-CN">zh-CN (简体中文)</option>
              <option value="en-US">en-US (English)</option>
            </select>
          </div>

          {/* Theme selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={{ margin: 0, fontSize: 11, color: c.label, fontWeight: 500 }}>
              <code style={{ background: c.codeBg, padding: "1px 4px", borderRadius: 3, fontSize: 10, color: c.label }}>theme</code> 主题切换
            </p>
            <div style={{ display: "flex", gap: 6 }}>
              {([THEME.LIGHT, THEME.DARK, THEME.AUTO] as const).map((t) => {
                const selected = theme === t;
                return (
                  <button
                    key={t}
                    onClick={() => {
                      setTheme(t);
                      sdkConfig.theme = t;
                    }}
                    style={{
                      flex: 1,
                      padding: "6px 0",
                      borderRadius: 8,
                      border: selected ? `2px solid ${c.selectedBorder}` : `1px solid ${c.unselectedBorder}`,
                      background: selected ? c.selectedBg : c.unselectedBg,
                      color: selected ? c.selectedText : c.unselectedText,
                      fontSize: 11,
                      fontWeight: selected ? 600 : 400,
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {t === THEME.LIGHT ? "☀️ Light" : t === THEME.DARK ? "🌙 Dark" : "💻 Auto"}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Text input */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 8,
              border: `1px solid ${c.inputBorder}`,
              fontSize: 12,
              resize: "vertical",
              boxSizing: "border-box",
              fontFamily: "inherit",
              background: c.inputBg,
              color: c.inputText,
            }}
            placeholder="输入测试文本..."
          />

          {/* chat() */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={{ margin: 0, fontSize: 11, color: c.label, fontWeight: 500 }}>
              <code style={{ background: c.codeBg, padding: "1px 4px", borderRadius: 3, fontSize: 10, color: c.label }}>chat(text)</code> 填入并发送消息
            </p>
            <button
              onClick={() => run("chat", () => OceanMCPSDK.chat(text))}
              disabled={!text.trim() || loading !== null}
              style={{
                ...btnBase,
                background: !text.trim() || loading !== null ? (isDark ? "#4b5563" : "#d1d5db") : "#3b82f6",
                cursor: !text.trim() || loading !== null ? "not-allowed" : "pointer",
              }}
            >
              {loading === "chat" ? "Sending..." : "chat()"}
            </button>
          </div>

          {/* setInput() */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={{ margin: 0, fontSize: 11, color: c.label, fontWeight: 500 }}>
              <code style={{ background: c.codeBg, padding: "1px 4px", borderRadius: 3, fontSize: 10, color: c.label }}>setInput(text)</code> 只填入输入框，不发送
            </p>
            <button
              onClick={() => run("setInput", () => OceanMCPSDK.setInput(text))}
              disabled={!text.trim() || loading !== null}
              style={{
                ...btnBase,
                background: !text.trim() || loading !== null ? (isDark ? "#4b5563" : "#d1d5db") : "#8b5cf6",
                cursor: !text.trim() || loading !== null ? "not-allowed" : "pointer",
              }}
            >
              {loading === "setInput" ? "Setting..." : "setInput()"}
            </button>
          </div>

          {/* getMessages() */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={{ margin: 0, fontSize: 11, color: c.label, fontWeight: 500 }}>
              <code style={{ background: c.codeBg, padding: "1px 4px", borderRadius: 3, fontSize: 10, color: c.label }}>getMessages()</code> 获取当前消息列表
            </p>
            <button
              onClick={() => run("getMessages", () => OceanMCPSDK.getMessages())}
              disabled={loading !== null}
              style={{
                ...btnBase,
                background: loading !== null ? (isDark ? "#4b5563" : "#d1d5db") : "#10b981",
                cursor: loading !== null ? "not-allowed" : "pointer",
              }}
            >
              {loading === "getMessages" ? "Loading..." : "getMessages()"}
            </button>
          </div>

          {/* clearMessages() */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={{ margin: 0, fontSize: 11, color: c.label, fontWeight: 500 }}>
              <code style={{ background: c.codeBg, padding: "1px 4px", borderRadius: 3, fontSize: 10, color: c.label }}>clearMessages()</code> 清空所有聊天记录
            </p>
            <button
              onClick={() => run("clearMessages", () => OceanMCPSDK.clearMessages())}
              disabled={loading !== null}
              style={{
                ...btnBase,
                background: loading !== null ? (isDark ? "#4b5563" : "#d1d5db") : "#ef4444",
                cursor: loading !== null ? "not-allowed" : "pointer",
              }}
            >
              {loading === "clearMessages" ? "Clearing..." : "clearMessages()"}
            </button>
          </div>

          {/* Result area */}
          {result && (
            <div>
              <p style={{ margin: 0, fontSize: 11, color: c.label, fontWeight: 500, marginBottom: 4 }}>Result:</p>
              <pre style={{
                margin: 0,
                padding: 8,
                borderRadius: 6,
                background: c.resultBg,
                border: `1px solid ${c.resultBorder}`,
                fontSize: 11,
                color: c.resultText,
                maxHeight: 120,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                fontFamily: "ui-monospace, monospace",
              }}>{result}</pre>
            </div>
          )}
        </div>
      )}
    </>
  );
}
