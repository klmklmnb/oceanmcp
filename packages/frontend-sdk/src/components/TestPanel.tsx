import React, { useState, useEffect, useRef, useCallback, useId } from "react";
import OceanMCPSDK from "../main";
import { sdkConfig, THEME, resolveTheme, type SupportedLocale, type Theme } from "../runtime/sdk-config";
import { chatBridge } from "../runtime/chat-bridge";
import {
  TEST_FIXTURE_PROMPTS,
  TEST_SKILL_NAMES,
  TEST_STANDALONE_TOOL_IDS,
  registerSkillFixtures,
  registerStandaloneToolFixtures,
  unregisterSkillFixtures,
  unregisterStandaloneToolFixtures,
} from "../test/tool-skill-fixtures";

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

const SAMPLE_OCR_IMAGE_URL =
  "https://patchwiki.biligame.com/images/ys/8/81/8393e6kjulrau058jy9qolyv30bfkiz.png";

const SAMPLE_PDF_URL = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";

function PdfTester({ c, isDark }: { c: PanelColors; isDark: boolean }) {
  const [url, setUrl] = useState(SAMPLE_PDF_URL);
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!url.trim()) return;
    setLoading(true);
    try {
      await OceanMCPSDK.chat(`请使用 readPdf 工具解析这个 PDF 文档并总结内容：${url.trim()}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com/file.pdf"
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 8,
          border: `1px solid ${c.inputBorder}`,
          fontSize: 12,
          boxSizing: "border-box" as const,
          fontFamily: "inherit",
          background: c.inputBg,
          color: c.inputText,
        }}
      />
      <button
        onClick={handleSend}
        disabled={!url.trim() || loading}
        style={{
          ...btnBase,
          background: !url.trim() || loading ? (isDark ? "#4b5563" : "#d1d5db") : "#f59e0b",
          cursor: !url.trim() || loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "发送中..." : "让 AI 解析 PDF"}
      </button>
    </div>
  );
}

function OcrTester({ c, isDark }: { c: PanelColors; isDark: boolean }) {
  const [imageUrl, setImageUrl] = useState(SAMPLE_OCR_IMAGE_URL);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSend = async () => {
    if (!imageUrl.trim()) return;
    setLoading(true);
    try {
      const parts: string[] = [
        `请对以下图片进行 OCR 识别，使用 imageOcr 工具。`,
        `imageUrl: ${imageUrl.trim()}`,
      ];
      if (model.trim()) parts.push(`model: ${model.trim()}`);
      if (prompt.trim()) parts.push(`prompt: ${prompt.trim()}`);
      await OceanMCPSDK.chat(parts.join("\n"));
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: `1px solid ${c.inputBorder}`,
    fontSize: 12,
    boxSizing: "border-box",
    fontFamily: "inherit",
    background: c.inputBg,
    color: c.inputText,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <input
        type="url"
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        placeholder="https://example.com/image.png"
        style={inputStyle}
      />
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          fontSize: 11,
          color: c.label,
          cursor: "pointer",
          textAlign: "left",
          textDecoration: "underline",
        }}
      >
        {showAdvanced ? "▲ 收起可选参数" : "▼ 展开可选参数 (model / prompt)"}
      </button>
      {showAdvanced && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="model（留空使用默认）"
            style={inputStyle}
          />
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="prompt（留空使用默认）"
            style={inputStyle}
          />
        </div>
      )}
      <button
        onClick={handleSend}
        disabled={!imageUrl.trim() || loading}
        style={{
          ...btnBase,
          background:
            !imageUrl.trim() || loading
              ? isDark
                ? "#4b5563"
                : "#d1d5db"
              : "#06b6d4",
          cursor: !imageUrl.trim() || loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Sending..." : "OCR 识别图片"}
      </button>
    </div>
  );
}

export function TestPanel() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("你好，请介绍一下你自己");
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [locale, setLocale] = useState<SupportedLocale | "">(sdkConfig.locale ?? "zh-CN");
  const [theme, setTheme] = useState<Theme | undefined>(sdkConfig.theme);
  const [debug, setDebug] = useState<boolean>(sdkConfig.debug);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  const toolMockTimeoutRef = useRef<number | null>(null);
  const [fixtureStatus, setFixtureStatus] = useState({ tools: false, skills: false });

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
  const dragStartRef = useRef({ x: 0, y: 0 });
  const DRAG_THRESHOLD = 5;
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
      dragStartRef.current = { x: e.clientX, y: e.clientY };
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
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      // Only start moving after exceeding the drag threshold
      if (!hasDraggedRef.current && dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      hasDraggedRef.current = true;
      const newX = Math.max(0, Math.min(e.clientX - dragOffsetRef.current.x, window.innerWidth - BUTTON_SIZE));
      const newY = Math.max(0, Math.min(e.clientY - dragOffsetRef.current.y, window.innerHeight - BUTTON_SIZE));
      setBtnPos({ x: newX, y: newY });
    },
    [],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);

      // Only snap to edge if the user actually dragged
      if (hasDraggedRef.current) {
        setBtnPos((prev) => snapToEdge(prev.x, prev.y));
      }
    },
    [snapToEdge],
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
    const spaceBelow = vh - (btnPos.y + BUTTON_SIZE + panelGap) - EDGE_MARGIN;
    const spaceAbove = btnPos.y - panelGap - EDGE_MARGIN;
    const openBelow = spaceBelow >= spaceAbove;

    return {
      position: "fixed",
      left,
      zIndex: 100000,
      width: panelWidth,
      boxSizing: "border-box" as const,
      padding: 20,
      borderRadius: 14,
      overflow: "auto",
      ...(openBelow
        ? {
            top: btnPos.y + BUTTON_SIZE + panelGap,
            maxHeight: Math.max(spaceBelow, 0),
          }
        : {
            bottom: vh - btnPos.y + panelGap,
            maxHeight: Math.max(spaceAbove, 0),
          }),
    };
  };

  const isDark = resolveTheme(theme) === THEME.DARK;
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

  const refreshFixtureStatus = useCallback(() => {
    const toolIds = new Set(OceanMCPSDK.getTools().map((tool) => tool.id));
    const skillNames = new Set(OceanMCPSDK.getSkills().map((skill) => skill.name));
    setFixtureStatus({
      tools: TEST_STANDALONE_TOOL_IDS.every((id) => toolIds.has(id)),
      skills: TEST_SKILL_NAMES.every((name) => skillNames.has(name)),
    });
  }, []);

  useEffect(() => {
    refreshFixtureStatus();
  }, [refreshFixtureStatus]);

  const registerFixtureTools = useCallback(async () => {
    const ids = registerStandaloneToolFixtures(OceanMCPSDK);
    refreshFixtureStatus();
    return { registeredTools: ids };
  }, [refreshFixtureStatus]);

  const registerFixtureSkills = useCallback(async () => {
    const names = registerSkillFixtures(OceanMCPSDK);
    refreshFixtureStatus();
    return { registeredSkills: names };
  }, [refreshFixtureStatus]);

  const registerAllFixtures = useCallback(async () => {
    const names = registerSkillFixtures(OceanMCPSDK);
    const ids = registerStandaloneToolFixtures(OceanMCPSDK);
    refreshFixtureStatus();
    return { registeredSkills: names, registeredTools: ids };
  }, [refreshFixtureStatus]);

  const clearAllFixtures = useCallback(async () => {
    unregisterSkillFixtures(OceanMCPSDK);
    unregisterStandaloneToolFixtures(OceanMCPSDK);
    refreshFixtureStatus();
    return { cleared: true };
  }, [refreshFixtureStatus]);

  const runFixturePrompt = useCallback(async (prompt: string) => {
    setText(prompt);
    await OceanMCPSDK.chat(prompt);
  }, []);

  const clearToolMockTimer = useCallback(() => {
    if (toolMockTimeoutRef.current != null) {
      window.clearTimeout(toolMockTimeoutRef.current);
      toolMockTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => () => clearToolMockTimer(), [clearToolMockTimer]);

  const injectMockMessages = useCallback(async (messages: any[]) => {
    await chatBridge.call("loadSession", messages);
  }, []);

  const injectToolStateSnapshot = useCallback(async () => {
    clearToolMockTimer();
    const messages = [
      {
        id: `mock-user-${Date.now()}`,
        role: "user",
        parts: [{ type: "text", text: "请帮我处理一个复杂任务" }],
      },
      {
        id: `mock-assistant-${Date.now()}`,
        role: "assistant",
        parts: [
          { type: "text", text: "以下是 tool 状态模拟：" },
          {
            type: "tool-browserExecute",
            toolCallId: "mock-running",
            state: "input-available",
            input: {
              functionId: "mock_lookup",
              arguments: { query: "ocean mcp" },
            },
          },
          {
            type: "tool-browserExecute",
            toolCallId: "mock-complete",
            state: "output-available",
            input: {
              functionId: "mock_fetch",
              arguments: { id: "42" },
            },
            output: { ok: true, rows: 3 },
          },
          {
            type: "tool-browserExecute",
            toolCallId: "mock-error",
            state: "output-error",
            input: {
              functionId: "mock_error_tool",
              arguments: { path: "/tmp/demo" },
            },
            errorText: "Network timeout while calling tool",
          },
          {
            type: "tool-browserExecute",
            toolCallId: "mock-denied",
            state: "output-denied",
            input: {
              functionId: "mock_write",
              arguments: { dryRun: false },
            },
          },
          {
            type: "tool-loadSkill",
            toolCallId: "mock-load-skill-1",
            state: "output-available",
            input: { name: "devops" },
            output: { loaded: true },
          },
          {
            type: "tool-loadSkill",
            toolCallId: "mock-load-skill-2",
            state: "input-available",
            input: { name: "mi-coffee" },
          },
        ],
      },
    ];
    await injectMockMessages(messages);
  }, [clearToolMockTimer, injectMockMessages]);

  const injectSlowRunningDemo = useCallback(async () => {
    clearToolMockTimer();
    const baseId = Date.now();
    const runningMessages = [
      {
        id: `mock-user-${baseId}`,
        role: "user",
        parts: [{ type: "text", text: "测试慢速 tool 调用" }],
      },
      {
        id: `mock-assistant-${baseId}`,
        role: "assistant",
        parts: [
          { type: "text", text: "正在模拟慢速调用（6 秒）..." },
          {
            type: "tool-browserExecute",
            toolCallId: "mock-slow-call",
            state: "input-available",
            input: {
              functionId: "mock_slow_tool",
              arguments: { waitSeconds: 6 },
            },
          },
        ],
      },
    ];

    await injectMockMessages(runningMessages);

    toolMockTimeoutRef.current = window.setTimeout(() => {
      const finishedMessages = [
        runningMessages[0],
        {
          id: `mock-assistant-done-${baseId}`,
          role: "assistant",
          parts: [
            { type: "text", text: "慢速调用完成。" },
            {
              type: "tool-browserExecute",
              toolCallId: "mock-slow-call",
              state: "output-available",
              input: {
                functionId: "mock_slow_tool",
                arguments: { waitSeconds: 6 },
              },
              output: { ok: true, elapsedMs: 6000 },
            },
          ],
        },
      ];
      void injectMockMessages(finishedMessages);
      toolMockTimeoutRef.current = null;
    }, 6000);
  }, [clearToolMockTimer, injectMockMessages]);

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
              {([undefined, THEME.LIGHT, THEME.DARK, THEME.AUTO] as const).map((t) => {
                const selected = theme === t;
                const label = t === undefined ? "🚫 undefined" : t === THEME.LIGHT ? "☀️ Light" : t === THEME.DARK ? "🌙 Dark" : "💻 Auto";
                return (
                  <button
                    key={t ?? "undefined"}
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
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Debug mode selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={{ margin: 0, fontSize: 11, color: c.label, fontWeight: 500 }}>
              <code style={{ background: c.codeBg, padding: "1px 4px", borderRadius: 3, fontSize: 10, color: c.label }}>debug</code> tool 展示模式
            </p>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => {
                  setDebug(false);
                  sdkConfig.debug = false;
                }}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  borderRadius: 8,
                  border: !debug ? `2px solid ${c.selectedBorder}` : `1px solid ${c.unselectedBorder}`,
                  background: !debug ? c.selectedBg : c.unselectedBg,
                  color: !debug ? c.selectedText : c.unselectedText,
                  fontSize: 11,
                  fontWeight: !debug ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                false (默认)
              </button>
              <button
                onClick={() => {
                  setDebug(true);
                  sdkConfig.debug = true;
                }}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  borderRadius: 8,
                  border: debug ? `2px solid ${c.selectedBorder}` : `1px solid ${c.unselectedBorder}`,
                  background: debug ? c.selectedBg : c.unselectedBg,
                  color: debug ? c.selectedText : c.unselectedText,
                  fontSize: 11,
                  fontWeight: debug ? 600 : 400,
                  cursor: "pointer",
                }}
              >
                true (卡片)
              </button>
            </div>
          </div>

          {/* Tool state simulator */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={{ margin: 0, fontSize: 11, color: c.label, fontWeight: 500 }}>
              <code style={{ background: c.codeBg, padding: "1px 4px", borderRadius: 3, fontSize: 10, color: c.label }}>tool state simulator</code> 页面内注入 tool 状态
            </p>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => run("tool-snapshot", injectToolStateSnapshot)}
                disabled={loading !== null}
                style={{
                  ...btnBase,
                  background: loading !== null ? (isDark ? "#4b5563" : "#d1d5db") : "#2563eb",
                  cursor: loading !== null ? "not-allowed" : "pointer",
                  padding: "8px 10px",
                }}
              >
                全状态快照
              </button>
              <button
                onClick={() => run("tool-slow", injectSlowRunningDemo)}
                disabled={loading !== null}
                style={{
                  ...btnBase,
                  background: loading !== null ? (isDark ? "#4b5563" : "#d1d5db") : "#0ea5e9",
                  cursor: loading !== null ? "not-allowed" : "pointer",
                  padding: "8px 10px",
                }}
              >
                6秒慢速演示
              </button>
            </div>
          </div>

          {/* Tool/Skill fixtures */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <p style={{ margin: 0, fontSize: 11, color: c.label, fontWeight: 500 }}>
              <code style={{ background: c.codeBg, padding: "1px 4px", borderRadius: 3, fontSize: 10, color: c.label }}>tool/skill fixtures</code> 注册并调用测试工具与技能
            </p>
            <p style={{ margin: 0, fontSize: 11, color: c.label }}>
              Tool: {fixtureStatus.tools ? "已注册" : "未注册"} | Skill: {fixtureStatus.skills ? "已注册" : "未注册"}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <button
                onClick={() => run("register-fixture-tools", registerFixtureTools)}
                disabled={loading !== null}
                style={{
                  ...btnBase,
                  background: loading !== null ? (isDark ? "#4b5563" : "#d1d5db") : "#0f766e",
                  cursor: loading !== null ? "not-allowed" : "pointer",
                  padding: "8px 10px",
                }}
              >
                注册 Tool
              </button>
              <button
                onClick={() => run("register-fixture-skills", registerFixtureSkills)}
                disabled={loading !== null}
                style={{
                  ...btnBase,
                  background: loading !== null ? (isDark ? "#4b5563" : "#d1d5db") : "#0369a1",
                  cursor: loading !== null ? "not-allowed" : "pointer",
                  padding: "8px 10px",
                }}
              >
                注册 Skill
              </button>
              <button
                onClick={() => run("register-fixture-all", registerAllFixtures)}
                disabled={loading !== null}
                style={{
                  ...btnBase,
                  background: loading !== null ? (isDark ? "#4b5563" : "#d1d5db") : "#2563eb",
                  cursor: loading !== null ? "not-allowed" : "pointer",
                  padding: "8px 10px",
                }}
              >
                一键注册
              </button>
              <button
                onClick={() => run("clear-fixture-all", clearAllFixtures)}
                disabled={loading !== null}
                style={{
                  ...btnBase,
                  background: loading !== null ? (isDark ? "#4b5563" : "#d1d5db") : "#dc2626",
                  cursor: loading !== null ? "not-allowed" : "pointer",
                  padding: "8px 10px",
                }}
              >
                清理 Fixture
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {TEST_FIXTURE_PROMPTS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => run(`fixture-call-${item.id}`, () => runFixturePrompt(item.prompt))}
                  disabled={loading !== null}
                  style={{
                    ...btnBase,
                    background: loading !== null ? (isDark ? "#4b5563" : "#d1d5db") : "#7c3aed",
                    cursor: loading !== null ? "not-allowed" : "pointer",
                    padding: "8px 10px",
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* PDF Reader test */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={{ margin: 0, fontSize: 11, color: c.label, fontWeight: 500 }}>
              <code style={{ background: c.codeBg, padding: "1px 4px", borderRadius: 3, fontSize: 10, color: c.label }}>readPdf</code> 输入 PDF URL，触发文本提取
            </p>
            <PdfTester c={c} isDark={isDark} />
          </div>

          <hr style={{ border: "none", borderTop: `1px solid ${c.border}`, margin: "4px 0" }} />

          {/* OCR test */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={{ margin: 0, fontSize: 11, color: c.label, fontWeight: 500 }}>
              <code style={{ background: c.codeBg, padding: "1px 4px", borderRadius: 3, fontSize: 10, color: c.label }}>imageOcr</code> 输入图片 URL，触发 OCR 识别
            </p>
            <OcrTester c={c} isDark={isDark} />
          </div>

          <hr style={{ border: "none", borderTop: `1px solid ${c.border}`, margin: "4px 0" }} />

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
