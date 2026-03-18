import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import OceanMCPSDK from "../main";
import { DemoNavbar } from "./DemoNavbar";
import { DemoFormTab } from "./DemoFormTab";
import { DemoTodoTab } from "./DemoTodoTab";
import { DemoFlowTab } from "./DemoFlowTab";
import { DemoTableTab } from "./DemoTableTab";
import { detectLocale, getStrings, type DemoLocale, type DemoStrings } from "./demo-i18n";
import {
  createFormSkill,
  createTodoSkill,
  createFlowSkill,
  createTableSkill,
  createNavigationSkill,
} from "./demo-skills";
import { tabStore, type DemoTab } from "./demo-store";
import { TestPanel } from "../components/TestPanel";
import { Analytics } from "@vercel/analytics/react"
import { SpeedInsights } from "@vercel/speed-insights/react"

// ─── Constants ───────────────────────────────────────────────────────────────

const CHAT_WIDTH_DEFAULT = 420;
const CHAT_WIDTH_MIN = 320;
const CHAT_WIDTH_MAX = 700;

/** Tab metadata for the pill tab bar. */
const TAB_META: { key: DemoTab; labelKey: keyof DemoStrings; icon: string }[] = [
  {
    key: "todo",
    labelKey: "tabTodo",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  },
  {
    key: "form",
    labelKey: "tabForm",
    icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
  },
  {
    key: "flow",
    labelKey: "tabFlow",
    icon: "M4 6h16M4 12h8m-8 6h16M20 6l-4 6 4 6",
  },
  {
    key: "table",
    labelKey: "tabTable",
    icon: "M3 10h18M3 14h18M3 6h18M3 18h18M8 6v12M16 6v12",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getTabFromHash(): DemoTab {
  const hash = window.location.hash.replace("#", "");
  if (hash === "form" || hash === "todo" || hash === "flow" || hash === "table") return hash;
  return "todo";
}

/** Build the universal suggestion list — 2 per tab, covering all 3 domains. */
function buildSuggestions(strings: DemoStrings) {
  return [
    // TODO (2) — first tab, shown by default
    { label: strings.todoSuggestion1, text: strings.todoSuggestion1Text },
    { label: strings.todoSuggestion2, text: strings.todoSuggestion2Text },
    // Form (2)
    { label: strings.formSuggestion1, text: strings.formSuggestion1Text },
    { label: strings.formSuggestion2, text: strings.formSuggestion2Text },
    // Flow (2)
    { label: strings.flowSuggestion1, text: strings.flowSuggestion1Text },
    { label: strings.flowSuggestion2, text: strings.flowSuggestion2Text },
    // Table (2)
    { label: strings.tableSuggestion1, text: strings.tableSuggestion1Text },
    { label: strings.tableSuggestion2, text: strings.tableSuggestion2Text },
  ];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DemoApp() {
  const [locale] = React.useState<DemoLocale>(detectLocale);
  const strings = getStrings(locale);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const sdkMountedRef = useRef(false);

  // Subscribe to tabStore so we re-render when the LLM (or user) switches tabs
  const tab = useSyncExternalStore(tabStore.subscribe, tabStore.getSnapshot);

  // ── Resizable chat pane state ──────────────────────────────────────────────
  const [chatWidth, setChatWidth] = useState(CHAT_WIDTH_DEFAULT);
  const isDraggingRef = useRef(false);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = "col-resize";
    // Prevent text selection while dragging
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      // Chat pane is on the right, so width = viewport width - mouse X
      const newWidth = Math.min(
        CHAT_WIDTH_MAX,
        Math.max(CHAT_WIDTH_MIN, window.innerWidth - e.clientX),
      );
      setChatWidth(newWidth);
    };
    const onMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Initialize tabStore from URL hash on first render
  useEffect(() => {
    tabStore.set(getTabFromHash());
  }, []);

  // Sync tabStore when browser hash changes (e.g. back/forward navigation)
  useEffect(() => {
    const handler = () => {
      const hashTab = getTabFromHash();
      if (hashTab !== tabStore.get()) {
        tabStore.set(hashTab);
      }
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  // ── Mount SDK once on initial render. Register all skills up-front.
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container || sdkMountedRef.current) return;
    sdkMountedRef.current = true;

    // Register all 5 skills (todo, form, flow, table, navigation)
    OceanMCPSDK.registerSkill(createTodoSkill());
    OceanMCPSDK.registerSkill(createFormSkill());
    OceanMCPSDK.registerSkill(createFlowSkill());
    OceanMCPSDK.registerSkill(createTableSkill());
    OceanMCPSDK.registerSkill(createNavigationSkill());

    // Mount the chat widget once — it stays across all tab switches
    OceanMCPSDK.mount({
      root: container,
      locale: locale === "zh" ? "zh-CN" : "en-US",
      theme: "auto",
      subagent: { enable: true },
      suggestions: buildSuggestions(strings),
      session: { enable: true, namespace: "demo" },
    });
  }, [locale, strings]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      {/* Top Navigation (logo + GitHub only) */}
      <DemoNavbar strings={strings} />

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left Pane: Tab Bar + Demo Content */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "#f8fafc",
          }}
        >
          {/* Horizontal Pill Tab Bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "12px 24px",
              borderBottom: "1px solid #e2e8f0",
              background: "#fff",
              flexShrink: 0,
            }}
          >
            {TAB_META.map(({ key, labelKey, icon }) => {
              const isActive = key === tab;
              return (
                <button
                  key={key}
                  onClick={() => tabStore.set(key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "7px 16px",
                    borderRadius: 20,
                    border: isActive
                      ? "1px solid #3b82f6"
                      : "1px solid #e2e8f0",
                    background: isActive ? "#eff6ff" : "#fff",
                    color: isActive ? "#2563eb" : "#64748b",
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    whiteSpace: "nowrap",
                    outline: "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = "#cbd5e1";
                      e.currentTarget.style.background = "#f8fafc";
                      e.currentTarget.style.color = "#475569";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = "#e2e8f0";
                      e.currentTarget.style.background = "#fff";
                      e.currentTarget.style.color = "#64748b";
                    }
                  }}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={icon} />
                  </svg>
                  {strings[labelKey] as string}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          <div style={{ flex: 1, padding: 24, overflow: "auto" }}>
            {tab === "todo" && <DemoTodoTab strings={strings} />}
            {tab === "form" && <DemoFormTab strings={strings} />}
            {tab === "flow" && <DemoFlowTab strings={strings} />}
            {tab === "table" && <DemoTableTab strings={strings} />}
          </div>
        </div>

        {/* Drag Handle */}
        <div
          onMouseDown={onDragStart}
          style={{
            flex: "0 0 4px",
            cursor: "col-resize",
            background: "#e2e8f0",
            transition: "background 0.15s",
            position: "relative",
            zIndex: 10,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#94a3b8";
          }}
          onMouseLeave={(e) => {
            if (!isDraggingRef.current) {
              e.currentTarget.style.background = "#e2e8f0";
            }
          }}
        />

        {/* Right Pane: Chat Widget (mounted once, universal, resizable) */}
        <div
          style={{
            flex: `0 0 ${chatWidth}px`,
            minWidth: CHAT_WIDTH_MIN,
            maxWidth: CHAT_WIDTH_MAX,
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          <div ref={chatContainerRef} style={{ flex: 1, height: "100%" }} />
        </div>
      </div>

      {/* Dev Test Panel (floating button) */}
      {import.meta.env.DEV && <TestPanel />}
      <Analytics />
      <SpeedInsights />
    </div>
  );
}
