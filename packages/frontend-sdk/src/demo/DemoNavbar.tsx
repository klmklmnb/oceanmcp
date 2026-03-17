import React from "react";
import type { DemoStrings } from "./demo-i18n";

export type DemoTab = "form" | "todo" | "flow";

interface DemoNavbarProps {
  activeTab: DemoTab;
  onTabChange: (tab: DemoTab) => void;
  strings: DemoStrings;
}

const TABS: { key: DemoTab; labelKey: keyof DemoStrings; icon: string }[] = [
  { key: "form", labelKey: "tabForm", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" },
  { key: "todo", labelKey: "tabTodo", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  { key: "flow", labelKey: "tabFlow", icon: "M4 6h16M4 12h8m-8 6h16M20 6l-4 6 4 6" },
];

export function DemoNavbar({ activeTab, onTabChange, strings }: DemoNavbarProps) {
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        height: 56,
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        gap: 12,
        flexShrink: 0,
      }}
    >
      {/* Logo & Title */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 24 }}>
        <img
          src="https://pub-46b4307a6ac249dda431cdfd7f715021.r2.dev/uploads/oceanmcp_icon.png"
          alt="OceanMCP"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            objectFit: "contain",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9", letterSpacing: -0.3 }}>
            {strings.title}
          </span>
          <span style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
            {strings.subtitle}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, flex: 1 }}>
        {TABS.map(({ key, labelKey, icon }) => {
          const isActive = key === activeTab;
          return (
            <button
              key={key}
              onClick={() => onTabChange(key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: isActive
                  ? "rgba(59, 130, 246, 0.2)"
                  : "transparent",
                color: isActive ? "#60a5fa" : "#94a3b8",
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                cursor: "pointer",
                transition: "all 0.15s ease",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  e.currentTarget.style.color = "#cbd5e1";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#94a3b8";
                }
              }}
            >
              <svg
                width="16"
                height="16"
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

      {/* GitHub link */}
      <a
        href="https://github.com/klmklmnb/oceanmcp"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "#94a3b8",
          textDecoration: "none",
          fontSize: 12,
          padding: "6px 10px",
          borderRadius: 6,
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "#f1f5f9";
          e.currentTarget.style.background = "rgba(255,255,255,0.05)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "#94a3b8";
          e.currentTarget.style.background = "transparent";
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
        GitHub
      </a>
    </nav>
  );
}
