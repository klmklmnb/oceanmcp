import React from "react";
import { TOOL_PART_STATE, isJSONSchemaParameters } from "@ocean-mcp/shared";
import { functionRegistry } from "../registry";
import { t } from "../locale";

type UserSelectOptionInput = {
  value: unknown;
  label?: string;
  description?: string;
};

type UserSelectInput = {
  functionId?: string;
  parameterName?: string;
  message?: string;
  defaultValue?: unknown;
  options?: UserSelectOptionInput[];
};

type UserSelectOutput = {
  functionId?: string;
  parameterName?: string;
  selectedValue?: unknown;
  selectedLabel?: string;
};

type UserSelectCardProps = {
  toolCallId: string;
  input?: UserSelectInput;
  output?: unknown;
  state: string;
  errorText?: string;
  onSubmit: (toolCallId: string, output: UserSelectOutput) => void;
  onDeny: (toolCallId: string) => void;
};

type SelectOption = {
  id: string;
  value: unknown;
  label: string;
  description?: string;
};

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function deriveOptionsFromDescription(description?: string): SelectOption[] {
  if (!description) return [];

  const candidates: string[] = [];

  // Quoted literals: "prod", 'intranet'
  for (const match of description.matchAll(/["'`]([^"'`]{1,80})["'`]/g)) {
    const token = match[1]?.trim();
    if (token && /^[a-zA-Z0-9_.-]+$/.test(token)) {
      candidates.push(token);
    }
  }

  // Parenthesized groups with separators: (testing/pre/prod)
  for (const match of description.matchAll(/\(([^)]+)\)/g)) {
    const inner = match[1] ?? "";
    const parts = inner
      .split(/[\/,|]/)
      .map((part) => part.trim())
      .filter((part) => /^[a-zA-Z0-9_.-]+$/.test(part));
    candidates.push(...parts);
  }

  // Mapping targets: foo -> prod
  for (const match of description.matchAll(/->\s*([a-zA-Z0-9_.-]+)/g)) {
    const token = match[1]?.trim();
    if (token) candidates.push(token);
  }

  const deduped = dedupeStrings(candidates);
  return deduped.map((value, index) => ({
    id: String(index),
    value,
    label: value,
  }));
}

function normalizeOutput(output: unknown): UserSelectOutput {
  if (output && typeof output === "object") {
    return output as UserSelectOutput;
  }
  if (output != null) {
    return { selectedValue: output, selectedLabel: String(output) };
  }
  return {};
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isSameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function UserSelectCard({
  toolCallId,
  input,
  output,
  state,
  errorText,
  onSubmit,
  onDeny,
}: UserSelectCardProps) {
  const paramDef = React.useMemo(() => {
    if (!input?.functionId || !input?.parameterName) return undefined;
    const fnDef = functionRegistry.get(input.functionId);
    return fnDef?.parameters && !isJSONSchemaParameters(fnDef.parameters)
      ? fnDef.parameters.find((p) => p.name === input.parameterName)
      : undefined;
  }, [input?.functionId, input?.parameterName]);

  const options = React.useMemo<SelectOption[]>(() => {
    if (Array.isArray(input?.options) && input.options.length > 0) {
      return input.options.map((option, index) => ({
        id: String(index),
        value: option.value,
        label: typeof option.label === "string" ? option.label : formatValue(option.value),
        description: typeof option.description === "string" ? option.description : undefined,
      }));
    }

    if (!paramDef) return [];

    if (!paramDef?.enumMap) return [];

    return Object.entries(paramDef.enumMap).map(([value, label], index) => ({
      id: String(index),
      value,
      label: String(label),
    }));
  }, [input?.options, paramDef]);

  const derivedOptions = React.useMemo<SelectOption[]>(() => {
    return deriveOptionsFromDescription(paramDef?.description);
  }, [paramDef?.description]);

  const finalOptions = React.useMemo(
    () => (options.length > 0 ? options : derivedOptions),
    [options, derivedOptions],
  );
  const isBinaryOptions = finalOptions.length === 2;

  const [selectedOptionId, setSelectedOptionId] = React.useState("");
  const [manualValue, setManualValue] = React.useState("");

  // Determine the initial option: prefer the option matching input.defaultValue, else first.
  const defaultOptionId = React.useMemo(() => {
    if (input?.defaultValue != null) {
      const match = finalOptions.find((opt) => isSameValue(opt.value, input.defaultValue));
      if (match) return match.id;
    }
    return finalOptions[0]?.id ?? "";
  }, [finalOptions, input?.defaultValue]);

  React.useEffect(() => {
    setSelectedOptionId(defaultOptionId);
    setManualValue("");
  }, [defaultOptionId, toolCallId]);

  const selectedOption = finalOptions.find(
    (option) => option.id === selectedOptionId,
  );

  // When the user clicks the explicit Deny button, addToolResult sets the
  // state to "output-available" but the output carries { denied: true }.
  // Treat this the same as OUTPUT_DENIED for rendering purposes.
  const isDenied =
    state === TOOL_PART_STATE.OUTPUT_DENIED ||
    (state === TOOL_PART_STATE.OUTPUT_AVAILABLE &&
      output != null &&
      typeof output === "object" &&
      (output as any).denied === true);

  const statusLabel = isDenied
    ? t("select.status.denied")
    : state === TOOL_PART_STATE.OUTPUT_AVAILABLE
      ? t("select.status.complete")
      : state === TOOL_PART_STATE.OUTPUT_ERROR
        ? t("select.status.error")
        : t("select.status.pending");

  const statusColor = isDenied
    ? "text-gray-500"
    : state === TOOL_PART_STATE.OUTPUT_AVAILABLE
      ? "text-emerald-600"
      : state === TOOL_PART_STATE.OUTPUT_ERROR
        ? "text-red-500"
        : "text-amber-600";

  const outputData = normalizeOutput(output);
  const selectedValueText = formatValue(outputData.selectedValue);
  const matchedOption = finalOptions.find((option) =>
    isSameValue(option.value, outputData.selectedValue),
  );
  const chosenLabel =
    (typeof outputData.selectedLabel === "string" ? outputData.selectedLabel : null)
    || matchedOption?.label
    || selectedValueText;

  const submitOption = (option: SelectOption) => {
    onSubmit(toolCallId, {
      functionId: input?.functionId,
      parameterName: input?.parameterName,
      selectedValue: option.value,
      selectedLabel: option.label,
    });
  };

  const submitManualValue = () => {
    const trimmed = manualValue.trim();
    if (!trimmed) return;
    onSubmit(toolCallId, {
      functionId: input?.functionId,
      parameterName: input?.parameterName,
      selectedValue: trimmed,
      selectedLabel: trimmed,
    });
  };

  return (
    <div className="my-3 rounded-xl border border-border bg-surface overflow-hidden shadow-card ocean-fade-in">
      <div className="px-4 py-3 border-b border-border bg-surface-secondary flex items-center gap-2">
        <span className="text-sm">🧭</span>
        <span className="text-sm font-semibold text-text-primary">
          {t("select.title")}
        </span>
        <span className={`ml-auto text-xs ${statusColor}`}>{statusLabel}</span>
      </div>

      {isDenied ? (
        <div className="p-4 text-sm text-text-tertiary">
          {t("select.deniedMessage")}
        </div>
      ) : state === TOOL_PART_STATE.OUTPUT_AVAILABLE ? (
        <div className="p-4 text-sm text-text-secondary">
          <div>{t("select.selected")} {chosenLabel}</div>
          {selectedValueText && selectedValueText !== chosenLabel && (
            <div className="mt-1 text-xs text-text-tertiary font-mono">
              {t("select.value")} {selectedValueText}
            </div>
          )}
        </div>
      ) : state === TOOL_PART_STATE.OUTPUT_ERROR ? (
        <div className="p-4 text-sm text-red-500">
          {typeof errorText === "string" ? errorText : t("select.failed")}
        </div>
      ) : (
        <>
          <div className="p-4">
            <p className="text-sm text-text-primary">
              {typeof input?.message === "string" ? input.message : t("select.prompt")}
            </p>

            {isBinaryOptions ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {finalOptions.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => submitOption(option)}
                      className="px-3 py-2 text-sm font-medium text-text-primary bg-surface-tertiary hover:bg-surface border border-border rounded-lg transition-colors cursor-pointer"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex justify-center">
                  <button
                    onClick={() => onDeny(toolCallId)}
                    className="px-4 py-1.5 text-xs font-medium text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary rounded-lg transition-colors cursor-pointer"
                  >
                    {t("select.deny")}
                  </button>
                </div>
              </>
            ) : finalOptions.length > 0 ? (
              <>
                <select
                  value={selectedOptionId}
                  onChange={(e) => setSelectedOptionId(e.target.value)}
                  className="mt-3 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ocean-400"
                >
                  {finalOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>

                {selectedOption?.description && (
                  <p className="mt-2 text-xs text-text-tertiary">
                    {selectedOption.description}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mt-2 text-xs text-text-tertiary">
                  {t("select.noOptions")}
                </p>
                <input
                  value={manualValue}
                  onChange={(e) => setManualValue(e.target.value)}
                  placeholder={t("select.inputPlaceholder")}
                  className="mt-3 w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ocean-400"
                />
              </>
            )}
          </div>

          {!isBinaryOptions && (
            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => onDeny(toolCallId)}
                className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-tertiary rounded-lg transition-colors cursor-pointer"
              >
                {t("select.deny")}
              </button>
              <button
                onClick={() => {
                  if (selectedOption) {
                    submitOption(selectedOption);
                    return;
                  }
                  submitManualValue();
                }}
                disabled={!selectedOption && !manualValue.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-ocean-600 hover:bg-ocean-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm cursor-pointer"
              >
                {t("select.confirm")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
