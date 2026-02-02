import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { SplitPane } from "./components/SplitPane";
import { initRegistry } from "./registry";
import "./index.css";

// Configuration
const DEFAULT_SERVER_URL = "http://localhost:4000";
const DEFAULT_WS_URL = "ws://localhost:4000/connect";

type SDKConfig = {
  serverUrl?: string;
  wsUrl?: string;
  triggerKey?: string; // Keyboard shortcut to toggle SDK
};

type HackerAgentSDKProps = {
  config?: SDKConfig;
};

function HackerAgentSDK({ config = {} }: HackerAgentSDKProps) {
  const [isOpen, setIsOpen] = useState(false);

  const serverUrl = config.serverUrl || DEFAULT_SERVER_URL;
  const wsUrl = config.wsUrl || DEFAULT_WS_URL;
  const triggerKey = config.triggerKey || "k"; // Ctrl/Cmd + K

  // Initialize registry on mount
  useEffect(() => {
    initRegistry();
  }, []);

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === triggerKey) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }

      // Escape to close
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [triggerKey, isOpen]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
          border: "none",
          boxShadow: "0 4px 14px rgba(34, 197, 94, 0.4)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "24px",
          transition: "transform 0.2s, box-shadow 0.2s",
          zIndex: 9998,
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.transform = "scale(1.1)";
          e.currentTarget.style.boxShadow = "0 6px 20px rgba(34, 197, 94, 0.5)";
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "0 4px 14px rgba(34, 197, 94, 0.4)";
        }}
        title="Open HackerAgent (Ctrl+K)"
      >
        ⚡
      </button>
    );
  }

  return (
    <div className="hacker-agent-overlay" onClick={() => setIsOpen(false)}>
      <div onClick={(e) => e.stopPropagation()}>
        <SplitPane
          serverUrl={serverUrl}
          wsUrl={wsUrl}
          onClose={() => setIsOpen(false)}
        />
      </div>
    </div>
  );
}

// Export the SDK component
export { HackerAgentSDK };

// Export registry functions for external use
export * from "./registry";

// Export types
export type * from "./types";

// Auto-mount function for script injection
export function mount(container?: HTMLElement, config?: SDKConfig): () => void {
  const targetContainer = container || document.createElement("div");

  if (!container) {
    targetContainer.id = "hacker-agent-root";
    document.body.appendChild(targetContainer);
  }

  const root = ReactDOM.createRoot(targetContainer);
  root.render(
    <React.StrictMode>
      <HackerAgentSDK config={config} />
    </React.StrictMode>
  );

  return () => {
    root.unmount();
    if (!container && targetContainer.parentNode) {
      targetContainer.parentNode.removeChild(targetContainer);
    }
  };
}

// For development: render to #root if it exists
if (import.meta.env.DEV) {
  // Initialize registry for development
  initRegistry();
  setTimeout(() => {
    const root = document.getElementById('itr-platform-deployment') as HTMLElement
    if (root) {
      ReactDOM.createRoot(root).render(
        <React.StrictMode>
          <SplitPane
            serverUrl={DEFAULT_SERVER_URL}
            wsUrl={DEFAULT_WS_URL}
            onClose={() => { }}
          />
        </React.StrictMode>
      );
    }
  }, 2000);
} else if (typeof window !== "undefined") {
  // Auto-mount when loaded as a script (production only, not in dev mode)
  const scriptTag = document.currentScript as HTMLScriptElement | null;
  const shouldAutoMount = scriptTag?.getAttribute("data-auto-mount") !== "false";

  if (shouldAutoMount) {
    // Wait for DOM to be ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => mount());
    } else {
      mount();
    }
  }
}
