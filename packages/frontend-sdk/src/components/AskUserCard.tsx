import React from "react";
import { TOOL_PART_STATE } from "oceanmcp-shared";
import { t } from "../locale";

// ── Types ────────────────────────────────────────────────────────────────────

type FieldSchema = {
  type: "string" | "number" | "boolean" | "array";
  title?: string;
  description?: string;
  enum?: any[];
  enumLabels?: Record<string, string>;
  default?: any;
  items?: { type?: string; enum?: any[] };
  format?: string;
};

type AskUserSchemaInput = {
  type: "object";
  properties?: Record<string, FieldSchema>;
  required?: string[];
};

type AskUserInput = {
  message?: string;
  schema?: AskUserSchemaInput;
};

type AskUserOutput = Record<string, any>;

type AskUserCardProps = {
  toolCallId: string;
  input?: AskUserInput;
  output?: unknown;
  state: string;
  errorText?: string;
  onSubmit: (toolCallId: string, output: AskUserOutput) => void;
  onDeny: (toolCallId: string) => void;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function enumLabel(value: any, enumLabels?: Record<string, string>): string {
  return enumLabels?.[String(value)] ?? String(value);
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ── Field Components ─────────────────────────────────────────────────────────

function StringEnumField({
  name,
  field,
  value,
  onChange,
}: {
  name: string;
  field: FieldSchema;
  value: string;
  onChange: (name: string, value: string) => void;
  isRequired: boolean;
}) {
  const options = field.enum ?? [];

  // Binary options (≤2) → render as buttons
  if (options.length <= 2) {
    return (
      <div className="flex gap-2">
        {options.map((opt: any) => {
          const val = String(opt);
          const label = enumLabel(opt, field.enumLabels);
          const isSelected = value === val;
          return (
            <button
              key={val}
              type="button"
              onClick={() => onChange(name, val)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors cursor-pointer ${
                isSelected
                  ? "bg-ocean-600 text-white border-ocean-600"
                  : "bg-surface-tertiary text-text-primary border-border hover:bg-surface"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  }

  // >2 options → select dropdown
  return (
    <select
      value={value}
      onChange={(e) => onChange(name, e.target.value)}
      className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ocean-400"
    >
      <option value="">{t("askUser.selectPlaceholder")}</option>
      {options.map((opt: any) => {
        const val = String(opt);
        return (
          <option key={val} value={val}>
            {enumLabel(opt, field.enumLabels)}
          </option>
        );
      })}
    </select>
  );
}

function StringField({
  name,
  field,
  value,
  onChange,
  isRequired,
}: {
  name: string;
  field: FieldSchema;
  value: string;
  onChange: (name: string, value: string) => void;
  isRequired: boolean;
}) {
  if (Array.isArray(field.enum) && field.enum.length > 0) {
    return (
      <StringEnumField
        name={name}
        field={field}
        value={value}
        onChange={onChange}
        isRequired={isRequired}
      />
    );
  }

  if (field.format === "date") {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        required={isRequired}
        className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ocean-400"
      />
    );
  }

  if (field.format === "time") {
    return (
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        required={isRequired}
        className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ocean-400"
      />
    );
  }

  if (field.format === "textarea") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        required={isRequired}
        placeholder={field.description ?? t("askUser.inputPlaceholder")}
        rows={3}
        className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ocean-400 resize-y"
      />
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(name, e.target.value)}
      required={isRequired}
      placeholder={field.description ?? t("askUser.inputPlaceholder")}
      className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ocean-400"
    />
  );
}

function NumberField({
  name,
  field,
  value,
  onChange,
  isRequired,
}: {
  name: string;
  field: FieldSchema;
  value: string;
  onChange: (name: string, value: string) => void;
  isRequired: boolean;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(name, e.target.value)}
      required={isRequired}
      placeholder={field.description ?? t("askUser.inputPlaceholder")}
      className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ocean-400"
    />
  );
}

function BooleanField({
  name,
  field,
  value,
  onChange,
}: {
  name: string;
  field: FieldSchema;
  value: boolean;
  onChange: (name: string, value: boolean) => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange(name, true)}
        className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors cursor-pointer ${
          value === true
            ? "bg-ocean-600 text-white border-ocean-600"
            : "bg-surface-tertiary text-text-primary border-border hover:bg-surface"
        }`}
      >
        {field.enumLabels?.["true"] ?? "Yes"}
      </button>
      <button
        type="button"
        onClick={() => onChange(name, false)}
        className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors cursor-pointer ${
          value === false
            ? "bg-ocean-600 text-white border-ocean-600"
            : "bg-surface-tertiary text-text-primary border-border hover:bg-surface"
        }`}
      >
        {field.enumLabels?.["false"] ?? "No"}
      </button>
    </div>
  );
}

function CheckboxGroupField({
  name,
  field,
  value,
  onChange,
}: {
  name: string;
  field: FieldSchema;
  value: string[];
  onChange: (name: string, value: string[]) => void;
}) {
  const options = field.items?.enum ?? [];

  const toggle = (opt: string) => {
    const next = value.includes(opt)
      ? value.filter((v) => v !== opt)
      : [...value, opt];
    onChange(name, next);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt: any) => {
        const val = String(opt);
        const label = enumLabel(opt, field.enumLabels);
        const checked = value.includes(val);
        return (
          <div
            key={val}
            role="checkbox"
            aria-checked={checked}
            tabIndex={0}
            onClick={() => toggle(val)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                toggle(val);
              }
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border cursor-pointer transition-colors select-none ${
              checked
                ? "bg-ocean-50 border-ocean-400 text-ocean-700"
                : "bg-surface-tertiary border-border text-text-primary hover:bg-surface"
            }`}
          >
            <span
              className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                checked
                  ? "bg-ocean-600 border-ocean-600 text-white"
                  : "bg-surface border-border"
              }`}
            >
              {checked && "\u2713"}
            </span>
            {label}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function AskUserCard({
  toolCallId,
  input,
  output,
  state,
  errorText,
  onSubmit,
  onDeny,
}: AskUserCardProps) {
  const schema = input?.schema;
  const properties = schema?.properties ?? {};
  const requiredFields = new Set(schema?.required ?? []);
  const fieldEntries = Object.entries(properties);

  // Compute initial values from defaults
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialValues = React.useMemo(() => {
    const vals: Record<string, any> = {};
    for (const [name, field] of fieldEntries) {
      if (field.default != null) {
        if (field.type === "boolean") {
          vals[name] = field.default;
        } else if (field.type === "array") {
          vals[name] = Array.isArray(field.default) ? field.default.map(String) : [];
        } else {
          vals[name] = String(field.default);
        }
      } else {
        if (field.type === "boolean") vals[name] = false;
        else if (field.type === "array") vals[name] = [];
        else vals[name] = "";
      }
    }
    return vals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldEntries.map(([n]) => n).join(",")]);

  const [formValues, setFormValues] = React.useState<Record<string, any>>(initialValues);

  React.useEffect(() => {
    setFormValues(initialValues);
  }, [toolCallId, initialValues]);

  const handleChange = React.useCallback((name: string, value: any) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const isDenied =
    state === TOOL_PART_STATE.OUTPUT_DENIED ||
    (state === TOOL_PART_STATE.OUTPUT_AVAILABLE &&
      output != null &&
      typeof output === "object" &&
      (output as any).denied === true);

  const statusLabel = isDenied
    ? t("askUser.status.denied")
    : state === TOOL_PART_STATE.OUTPUT_AVAILABLE
      ? t("askUser.status.complete")
      : state === TOOL_PART_STATE.OUTPUT_ERROR
        ? t("askUser.status.error")
        : t("askUser.status.pending");

  const statusColor = isDenied
    ? "text-gray-500"
    : state === TOOL_PART_STATE.OUTPUT_AVAILABLE
      ? "text-emerald-600"
      : state === TOOL_PART_STATE.OUTPUT_ERROR
        ? "text-red-500"
        : "text-amber-600";

  const handleSubmit = () => {
    const result: Record<string, any> = {};
    for (const [name, field] of fieldEntries) {
      const raw = formValues[name];
      if (field.type === "number") {
        const num = parseFloat(raw);
        result[name] = isNaN(num) ? raw : num;
      } else if (field.type === "boolean") {
        result[name] = raw;
      } else if (field.type === "array") {
        result[name] = Array.isArray(raw) ? raw : [];
      } else {
        result[name] = raw;
      }
    }
    onSubmit(toolCallId, result);
  };

  const isValid = fieldEntries.every(([name, field]) => {
    if (!requiredFields.has(name)) return true;
    const val = formValues[name];
    if (field.type === "array") return Array.isArray(val) && val.length > 0;
    if (field.type === "boolean") return true;
    return val !== "" && val != null;
  });

  // ── Completed / Denied / Error states ──
  if (isDenied || state === TOOL_PART_STATE.OUTPUT_AVAILABLE || state === TOOL_PART_STATE.OUTPUT_ERROR) {
    const outputData = (output != null && typeof output === "object") ? output as Record<string, any> : {};

    return (
      <div className="my-3 rounded-xl border border-border bg-surface overflow-hidden shadow-card ocean-fade-in">
        <div className="px-4 py-3 border-b border-border bg-surface-secondary flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">
            {t("askUser.title")}
          </span>
          <span className={`ml-auto text-xs ${statusColor}`}>{statusLabel}</span>
        </div>

        {isDenied ? (
          <div className="p-4 text-sm text-text-tertiary">
            {t("askUser.deniedMessage")}
          </div>
        ) : state === TOOL_PART_STATE.OUTPUT_ERROR ? (
          <div className="p-4 text-sm text-red-500">
            {typeof errorText === "string" ? errorText : t("askUser.failed")}
          </div>
        ) : (
          <div className="p-4 space-y-1">
            {fieldEntries.map(([name, field]) => {
              const val = outputData[name];
              if (val === undefined) return null;
              return (
                <div key={name} className="text-sm text-text-secondary">
                  <span className="font-medium">{field.title ?? name}:</span>{" "}
                  <span className="font-mono text-xs">{formatValue(val)}</span>
                </div>
              );
            })}
            {fieldEntries.length === 0 && (
              <div className="text-sm text-text-secondary font-mono">
                {formatValue(output)}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Input form state ──
  return (
    <div className="my-3 rounded-xl border border-border bg-surface overflow-hidden shadow-card ocean-fade-in">
      <div className="px-4 py-3 border-b border-border bg-surface-secondary flex items-center gap-2">
        <span className="text-sm font-semibold text-text-primary">
          {t("askUser.title")}
        </span>
        <span className={`ml-auto text-xs ${statusColor}`}>{statusLabel}</span>
      </div>

      <div className="p-4 space-y-4">
        {input?.message && (
          <p className="text-sm text-text-primary">{input.message}</p>
        )}

        {fieldEntries.map(([name, field]) => (
          <div key={name} className="space-y-1.5">
            <label className="text-sm font-medium text-text-primary flex items-center gap-1">
              {field.title ?? name}
              {requiredFields.has(name) && (
                <span className="text-red-500 text-xs">*</span>
              )}
            </label>
            {field.description && !field.enum && field.format !== "textarea" && (
              <p className="text-xs text-text-tertiary">{field.description}</p>
            )}

            {field.type === "string" && (
              <StringField
                name={name}
                field={field}
                value={formValues[name] ?? ""}
                onChange={handleChange}
                isRequired={requiredFields.has(name)}
              />
            )}
            {field.type === "number" && (
              <NumberField
                name={name}
                field={field}
                value={formValues[name] ?? ""}
                onChange={handleChange}
                isRequired={requiredFields.has(name)}
              />
            )}
            {field.type === "boolean" && (
              <BooleanField
                name={name}
                field={field}
                value={formValues[name] ?? false}
                onChange={handleChange as any}
              />
            )}
            {field.type === "array" && field.items?.enum && (
              <CheckboxGroupField
                name={name}
                field={field}
                value={formValues[name] ?? []}
                onChange={handleChange as any}
              />
            )}
          </div>
        ))}
      </div>

      <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
        <button
          onClick={() => onDeny(toolCallId)}
          className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-tertiary rounded-lg transition-colors cursor-pointer"
        >
          {t("askUser.deny")}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!isValid}
          className="px-4 py-2 text-sm font-medium text-white bg-ocean-600 hover:bg-ocean-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm cursor-pointer"
        >
          {t("askUser.confirm")}
        </button>
      </div>
    </div>
  );
}
