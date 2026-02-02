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

// Auto-mount when loaded as a script
if (typeof window !== "undefined") {
  // Check if we should auto-mount
  const scriptTag = document.currentScript as HTMLScriptElement | null;
  const autoMount = scriptTag?.getAttribute("data-auto-mount") !== "false";
  
  if (autoMount) {
    // Wait for DOM to be ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => mount());
    } else {
      mount();
    }
  }
}

// For development: render to #root if it exists
const rootElement = document.getElementById("root");
if (rootElement && import.meta.env.DEV) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <div style={{ 
        minHeight: "100vh", 
        background: "#0a0a0a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontFamily: "system-ui, sans-serif"
      }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: "48px", marginBottom: "16px" }}>⚡ HackerAgent SDK</h1>
          <p style={{ color: "#888", marginBottom: "24px" }}>
            Press <kbd style={{ 
              background: "#333", 
              padding: "4px 8px", 
              borderRadius: "4px",
              border: "1px solid #444"
            }}>Ctrl+K</kbd> or click the button to open
          </p>
          <p style={{ color: "#666", fontSize: "14px" }}>
            Make sure the MCP server is running on port 4000
          </p>
        </div>
      </div>
      <HackerAgentSDK />
    </React.StrictMode>
  );
}
