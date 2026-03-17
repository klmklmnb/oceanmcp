import React, { useState, useEffect, useCallback, useRef } from "react";
import OceanMCPSDK from "../main";
import { DemoNavbar, type DemoTab } from "./DemoNavbar";
import { DemoFormTab } from "./DemoFormTab";
import { DemoTodoTab } from "./DemoTodoTab";
import { DemoFlowTab } from "./DemoFlowTab";
import { detectLocale, getStrings, type DemoLocale } from "./demo-i18n";
import { createFormSkill, createTodoSkill, createFlowSkill } from "./demo-skills";
import { todoStore, flowStore, formStore } from "./demo-store";
import { TestPanel } from "../components/TestPanel";

const SKILL_NAMES = ["demo-form-builder", "demo-todo-manager", "demo-flow-editor"];

function getTabFromHash(): DemoTab {
  const hash = window.location.hash.replace("#", "");
  if (hash === "form" || hash === "todo" || hash === "flow") return hash;
  return "form";
}

export function DemoApp() {
  const [tab, setTab] = useState<DemoTab>(getTabFromHash);
  const [locale] = useState<DemoLocale>(detectLocale);
  const strings = getStrings(locale);
  const chatMountedRef = useRef(false);
  const prevTabRef = useRef<DemoTab | null>(null);

  // Sync tab state with URL hash
  const onTabChange = useCallback((newTab: DemoTab) => {
    setTab(newTab);
    window.location.hash = newTab;
  }, []);

  useEffect(() => {
    const handler = () => setTab(getTabFromHash());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  // Register / unregister skills based on active tab
  useEffect(() => {
    // Unregister previous tab's skill
    if (prevTabRef.current && prevTabRef.current !== tab) {
      const prevSkillName = SKILL_NAMES[
        prevTabRef.current === "form" ? 0 : prevTabRef.current === "todo" ? 1 : 2
      ];
      try {
        OceanMCPSDK.unregisterSkill(prevSkillName);
      } catch {
        // Skill may not be registered yet on first render
      }
    }

    // Register current tab's skill
    const skill =
      tab === "form"
        ? createFormSkill()
        : tab === "todo"
          ? createTodoSkill()
          : createFlowSkill();

    OceanMCPSDK.registerSkill(skill);
    prevTabRef.current = tab;
  }, [tab]);

  // Mount the SDK chat widget via a ref callback — guarantees the DOM
  // element exists when mount() is called (avoids getElementById timing issues).
  const chatContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || chatMountedRef.current) return;
      chatMountedRef.current = true;

      const suggestions =
        tab === "form"
          ? [
              { label: strings.formSuggestion1, text: strings.formSuggestion1Text },
              { label: strings.formSuggestion2, text: strings.formSuggestion2Text },
              { label: strings.formSuggestion3, text: strings.formSuggestion3Text },
            ]
          : tab === "todo"
            ? [
                { label: strings.todoSuggestion1, text: strings.todoSuggestion1Text },
                { label: strings.todoSuggestion2, text: strings.todoSuggestion2Text },
                { label: strings.todoSuggestion3, text: strings.todoSuggestion3Text },
              ]
            : [
                { label: strings.flowSuggestion1, text: strings.flowSuggestion1Text },
                { label: strings.flowSuggestion2, text: strings.flowSuggestion2Text },
                { label: strings.flowSuggestion3, text: strings.flowSuggestion3Text },
              ];

      OceanMCPSDK.mount({
        root: node,
        locale: locale === "zh" ? "zh-CN" : "en-US",
        theme: "auto",
        avatar: "https://pub-46b4307a6ac249dda431cdfd7f715021.r2.dev/uploads/oceanmcp_icon.png",
        subagent: { enable: true },
        suggestions,
      });
    },
    [], // Stable callback — only mounts once
  );

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
      {/* Top Navigation */}
      <DemoNavbar activeTab={tab} onTabChange={onTabChange} strings={strings} />

      {/* Main Content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
        }}
      >
        {/* Left Pane: Demo Content */}
        <div
          style={{
            flex: "1 1 60%",
            minWidth: 0,
            padding: 24,
            overflow: "auto",
            background: "#f8fafc",
          }}
        >
          {tab === "form" && <DemoFormTab strings={strings} />}
          {tab === "todo" && <DemoTodoTab strings={strings} />}
          {tab === "flow" && <DemoFlowTab strings={strings} />}
        </div>

        {/* Right Pane: Chat Widget */}
        <div
          style={{
            flex: "0 0 420px",
            minWidth: 360,
            maxWidth: 500,
            borderLeft: "1px solid #e2e8f0",
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
    </div>
  );
}
