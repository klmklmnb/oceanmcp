import React, { useSyncExternalStore } from "react";
import { formStore } from "./demo-store";
import type { DemoStrings } from "./demo-i18n";

interface DemoFormTabProps {
  strings: DemoStrings;
}

export function DemoFormTab({ strings }: DemoFormTabProps) {
  const state = useSyncExternalStore(formStore.subscribe, formStore.getSnapshot);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, height: "100%" }}>
      {/* Header */}
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#1e293b" }}>
          {strings.formTitle}
        </h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
          {strings.formDescription}
        </p>
      </div>

      {/* Form Preview Area */}
      <div
        style={{
          flex: 1,
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          background: "#fff",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Preview Header */}
        <div
          style={{
            padding: "12px 20px",
            borderBottom: "1px solid #e2e8f0",
            background: "#f8fafc",
            borderRadius: "12px 12px 0 0",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>
            {strings.formPreviewTitle}
          </span>
          {state.title && (
            <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: "auto" }}>
              {state.title}
            </span>
          )}
        </div>

        {/* Preview Content */}
        <div style={{ flex: 1, padding: 24, overflow: "auto" }}>
          {!state.schema ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: 12,
                color: "#94a3b8",
              }}
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span style={{ fontSize: 14 }}>{strings.formPreviewEmpty}</span>
            </div>
          ) : (
            <FormPreviewRenderer schema={state.schema} title={state.title} lastSubmission={state.lastSubmission} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Simple Form Preview Renderer ────────────────────────────────────────────

function FormPreviewRenderer({
  schema,
  title,
  lastSubmission,
}: {
  schema: Record<string, any>;
  title: string;
  lastSubmission: Record<string, any> | null;
}) {
  const properties = schema.properties ?? {};
  const required = new Set<string>(schema.required ?? []);
  const fields = Object.entries(properties);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {title && (
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#1e293b" }}>{title}</h3>
      )}

      {fields.map(([key, prop]: [string, any]) => (
        <FormFieldPreview
          key={key}
          name={key}
          prop={prop}
          isRequired={required.has(key)}
          value={lastSubmission?.[key]}
        />
      ))}

      {lastSubmission && (
        <div
          style={{
            marginTop: 8,
            padding: 16,
            borderRadius: 8,
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "#166534", marginBottom: 8 }}>
            Last Submission
          </div>
          <pre
            style={{
              margin: 0,
              fontSize: 12,
              color: "#374151",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {JSON.stringify(lastSubmission, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function FormFieldPreview({
  name,
  prop,
  isRequired,
  value,
}: {
  name: string;
  prop: Record<string, any>;
  isRequired: boolean;
  value?: any;
}) {
  const label = prop.title || name;
  const type = prop.type;
  const format = prop.format;
  const enumValues: string[] | undefined = prop.enum;
  const enumLabels: Record<string, string> | undefined = prop.enumLabels;

  const labelEl = (
    <label style={{ fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 4 }}>
      {label}
      {isRequired && <span style={{ color: "#ef4444", marginLeft: 2 }}>*</span>}
    </label>
  );

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    fontSize: 13,
    background: value !== undefined ? "#f0fdf4" : "#fff",
    color: "#374151",
    boxSizing: "border-box",
  };

  // Enum with enumLabels => select or toggle
  if (enumValues) {
    if (enumValues.length <= 2) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {labelEl}
          <div style={{ display: "flex", gap: 8 }}>
            {enumValues.map((v) => (
              <div
                key={v}
                style={{
                  padding: "6px 16px",
                  borderRadius: 6,
                  border: `1px solid ${value === v ? "#3b82f6" : "#d1d5db"}`,
                  background: value === v ? "#eff6ff" : "#fff",
                  color: value === v ? "#1d4ed8" : "#6b7280",
                  fontSize: 12,
                  fontWeight: value === v ? 600 : 400,
                  cursor: "default",
                }}
              >
                {enumLabels?.[v] ?? v}
              </div>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {labelEl}
        <select disabled style={{ ...inputStyle, cursor: "default" }} value={value ?? ""}>
          <option value="">-- select --</option>
          {enumValues.map((v) => (
            <option key={v} value={v}>
              {enumLabels?.[v] ?? v}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Array with items.enum => checkboxes
  if (type === "array" && prop.items?.enum) {
    const opts: string[] = prop.items.enum;
    const labels = prop.enumLabels ?? {};
    const checked = Array.isArray(value) ? new Set(value) : new Set<string>();
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {labelEl}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {opts.map((v) => (
            <label
              key={v}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                color: "#374151",
                cursor: "default",
              }}
            >
              <input type="checkbox" disabled checked={checked.has(v)} />
              {labels[v] ?? v}
            </label>
          ))}
        </div>
      </div>
    );
  }

  // Boolean
  if (type === "boolean") {
    const boolLabels = prop.enumLabels ?? { true: "Yes", false: "No" };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {labelEl}
        <div style={{ display: "flex", gap: 8 }}>
          {["true", "false"].map((v) => (
            <div
              key={v}
              style={{
                padding: "6px 16px",
                borderRadius: 6,
                border: `1px solid ${String(value) === v ? "#3b82f6" : "#d1d5db"}`,
                background: String(value) === v ? "#eff6ff" : "#fff",
                color: String(value) === v ? "#1d4ed8" : "#6b7280",
                fontSize: 12,
                cursor: "default",
              }}
            >
              {boolLabels[v] ?? v}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Textarea
  if (format === "textarea") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {labelEl}
        <textarea
          disabled
          rows={3}
          style={{ ...inputStyle, resize: "vertical", cursor: "default" }}
          placeholder={prop.description ?? ""}
          value={value ?? ""}
        />
      </div>
    );
  }

  // Number
  if (type === "number") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {labelEl}
        <input
          disabled
          type="number"
          style={{ ...inputStyle, cursor: "default" }}
          placeholder={prop.description ?? ""}
          value={value ?? ""}
        />
      </div>
    );
  }

  // Default: text input
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {labelEl}
      <input
        disabled
        type={format === "date" ? "date" : format === "time" ? "time" : "text"}
        style={{ ...inputStyle, cursor: "default" }}
        placeholder={prop.description ?? ""}
        value={value ?? ""}
      />
    </div>
  );
}
