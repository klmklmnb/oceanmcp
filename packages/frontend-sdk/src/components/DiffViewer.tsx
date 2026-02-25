import React from "react";
import { DiffEditor } from "@monaco-editor/react";

type DiffViewerProps = {
  label: string;
  oldValue: string;
  newValue: string;
  language?: string;
};

/**
 * Error boundary to catch Monaco editor initialization failures.
 * Falls back to a plain text diff display.
 */
class DiffViewerErrorBoundary extends React.Component<
  { children: React.ReactNode; oldValue: string; newValue: string },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="text-xs text-text-tertiary">
          <p className="mb-1">Failed to load diff editor. Plain diff:</p>
          <pre className="bg-surface-tertiary rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto font-mono">
            {"--- old\n+++ new\n\n"}
            {this.props.oldValue}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Monaco-based diff viewer — renders a read-only side-by-side diff
 * of two string values inside a tool card.
 */
export function DiffViewer({
  label,
  oldValue,
  newValue,
  language = "html",
}: DiffViewerProps) {
  return (
    <div className="mt-2 mb-1">
      <p className="text-xs font-medium text-text-tertiary mb-1.5">{label}</p>
      <DiffViewerErrorBoundary oldValue={oldValue} newValue={newValue}>
        <div
          className="rounded-lg overflow-hidden border border-border"
          style={{ height: 320 }}
        >
          <DiffEditor
            original={oldValue}
            modified={newValue}
            language={language}
            theme="vs-dark"
            loading={
              <div className="flex items-center justify-center h-full text-xs text-text-tertiary">
                Loading diff editor...
              </div>
            }
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 12,
              lineNumbers: "on",
              wordWrap: "on",
            }}
          />
        </div>
      </DiffViewerErrorBoundary>
    </div>
  );
}
