import React, { useState } from "react";
import OceanMCPSDK from "../main";
import { sdkConfig, type SupportedLocale } from "../runtime/sdk-config";

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

const labelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: "#6b7280",
  fontWeight: 500,
};

const codeStyle: React.CSSProperties = {
  background: "#f3f4f6",
  padding: "1px 4px",
  borderRadius: 3,
  fontSize: 10,
};

const resultBoxStyle: React.CSSProperties = {
  margin: 0,
  padding: 8,
  borderRadius: 6,
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  fontSize: 11,
  color: "#374151",
  maxHeight: 120,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  fontFamily: "ui-monospace, monospace",
};

export function TestPanel() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("你好，请介绍一下你自己");
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [locale, setLocale] = useState<SupportedLocale | "">(sdkConfig.locale ?? "zh-CN");

  // Sync default locale to sdkConfig on first render
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
      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 100000,
          width: 36,
          height: 36,
          borderRadius: 10,
          border: "none",
          background: open ? "#ef4444" : "#3b82f6",
          color: "#fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          transition: "background 0.15s",
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
            position: "fixed",
            top: 60,
            right: 16,
            zIndex: 100000,
            width: 320,
            padding: 20,
            borderRadius: 14,
            background: "#fff",
            border: "1px solid #e5e7eb",
            boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            fontFamily: "system-ui, sans-serif",
            maxHeight: "calc(100vh - 80px)",
            overflow: "auto",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14, color: "#374151" }}>
            SDK Test Panel
          </h3>

          {/* Locale selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={labelStyle}>
              <code style={codeStyle}>locale</code> 模型回复语言
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
                border: "1px solid #d1d5db",
                fontSize: 12,
                background: "#fff",
                color: "#374151",
                cursor: "pointer",
              }}
            >
              <option value="">Auto (不指定)</option>
              <option value="zh-CN">zh-CN (简体中文)</option>
              <option value="en-US">en-US (English)</option>
            </select>
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
              border: "1px solid #d1d5db",
              fontSize: 12,
              resize: "vertical",
              boxSizing: "border-box",
              fontFamily: "inherit",
            }}
            placeholder="输入测试文本..."
          />

          {/* chat() */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={labelStyle}>
              <code style={codeStyle}>chat(text)</code> 填入并发送消息
            </p>
            <button
              onClick={() => run("chat", () => OceanMCPSDK.chat(text))}
              disabled={!text.trim() || loading !== null}
              style={{
                ...btnBase,
                background: !text.trim() || loading !== null ? "#d1d5db" : "#3b82f6",
                cursor: !text.trim() || loading !== null ? "not-allowed" : "pointer",
              }}
            >
              {loading === "chat" ? "Sending..." : "chat()"}
            </button>
          </div>

          {/* setInput() */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={labelStyle}>
              <code style={codeStyle}>setInput(text)</code> 只填入输入框，不发送
            </p>
            <button
              onClick={() => run("setInput", () => OceanMCPSDK.setInput(text))}
              disabled={!text.trim() || loading !== null}
              style={{
                ...btnBase,
                background: !text.trim() || loading !== null ? "#d1d5db" : "#8b5cf6",
                cursor: !text.trim() || loading !== null ? "not-allowed" : "pointer",
              }}
            >
              {loading === "setInput" ? "Setting..." : "setInput()"}
            </button>
          </div>

          {/* getMessages() */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={labelStyle}>
              <code style={codeStyle}>getMessages()</code> 获取当前消息列表
            </p>
            <button
              onClick={() => run("getMessages", () => OceanMCPSDK.getMessages())}
              disabled={loading !== null}
              style={{
                ...btnBase,
                background: loading !== null ? "#d1d5db" : "#10b981",
                cursor: loading !== null ? "not-allowed" : "pointer",
              }}
            >
              {loading === "getMessages" ? "Loading..." : "getMessages()"}
            </button>
          </div>

          {/* clearMessages() */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={labelStyle}>
              <code style={codeStyle}>clearMessages()</code> 清空所有聊天记录
            </p>
            <button
              onClick={() => run("clearMessages", () => OceanMCPSDK.clearMessages())}
              disabled={loading !== null}
              style={{
                ...btnBase,
                background: loading !== null ? "#d1d5db" : "#ef4444",
                cursor: loading !== null ? "not-allowed" : "pointer",
              }}
            >
              {loading === "clearMessages" ? "Clearing..." : "clearMessages()"}
            </button>
          </div>

          {/* Result area */}
          {result && (
            <div>
              <p style={{ ...labelStyle, marginBottom: 4 }}>Result:</p>
              <pre style={resultBoxStyle}>{result}</pre>
            </div>
          )}
        </div>
      )}
    </>
  );
}
