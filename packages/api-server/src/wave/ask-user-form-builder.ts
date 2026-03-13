/**
 * Wave form builder — transforms JSON Schema form definitions into Wave card
 * form elements.
 *
 * The `askUser` tool receives a JSON Schema (type: "object") from the LLM.
 * This module converts that schema into Wave interactive card elements using
 * the `@mihoyo/wave-opensdk` card builders.
 *
 * Supported mappings:
 *   - string + enum (≤3)           → buttons (cardFlow + cardButton)
 *   - string + enum (>3)           → cardSelectStatic
 *   - string + format:"date"       → cardDatePicker
 *   - string + format:"time"       → cardTimePicker (manual construction)
 *   - string + format:"textarea"   → cardInput(input_type:"textarea")
 *   - string (plain)               → cardInput(input_type:"text")
 *   - number                       → cardInput(input_type:"text") (parsed on return)
 *   - boolean                      → cardSelectStatic with yes/no
 *   - array + items.enum           → cardCheckboxGroup (manual construction)
 *
 * For single-field enum schemas the caller should use the simpler
 * button/dropdown card path instead of a full form.
 */

import {
  CardTag,
  cardButton,
  cardFlow,
  cardForm,
  cardColumn,
  cardHeader,
  cardMarkdown,
  cardOptionFormSubmit,
  cardOptionValue,
  cardSelectStatic,
  cardDatePicker,
  cardPlainText,
  type Card,
  type CardInput,
  type CardTimePicker,
  type CardCheckboxGroup,
  type MsgCard,
} from "@mihoyo/wave-opensdk";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AskUserFieldSchema {
  type: "string" | "number" | "boolean" | "array";
  title?: string;
  description?: string;
  enum?: any[];
  enumLabels?: Record<string, string>;
  default?: any;
  items?: { type?: string; enum?: any[] };
  format?: string;
}

export interface AskUserSchema {
  type: "object";
  properties: Record<string, AskUserFieldSchema>;
  required?: string[];
}

export interface AskUserInput {
  message: string;
  schema: AskUserSchema;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get display label for an enum value. */
function enumLabel(
  value: any,
  enumLabels?: Record<string, string>,
): string {
  const key = String(value);
  return enumLabels?.[key] ?? key;
}

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Detect whether this schema is a "simple select" — a single enum field that
 * can be rendered as buttons or a dropdown without a full form card.
 */
export function isSimpleSelectSchema(schema: AskUserSchema): boolean {
  const keys = Object.keys(schema.properties ?? {});
  if (keys.length !== 1) return false;
  const field = schema.properties[keys[0]];
  return (
    field.type === "string" &&
    Array.isArray(field.enum) &&
    field.enum.length > 0
  );
}

/**
 * Extract the single enum field info for simple-select rendering.
 */
export function getSimpleSelectInfo(schema: AskUserSchema): {
  fieldName: string;
  options: Array<{ value: string; label?: string }>;
  defaultValue?: string;
} {
  const fieldName = Object.keys(schema.properties)[0];
  const field = schema.properties[fieldName];
  const options = (field.enum ?? []).map((v: any) => ({
    value: String(v),
    label: enumLabel(v, field.enumLabels),
  }));
  const defaultValue =
    field.default != null ? String(field.default) : undefined;
  return { fieldName, options, defaultValue };
}

// ── Card Builders ────────────────────────────────────────────────────────────

/** Build a Wave CardInput element (text or textarea). No SDK helper exists. */
function buildCardInput(
  name: string,
  opts: {
    label?: string;
    inputType?: "text" | "textarea";
    placeholder?: string;
    initialValue?: string;
    required?: boolean;
    maxLength?: number;
    maxRow?: number;
  },
): CardInput {
  return {
    tag: CardTag.Input,
    name,
    label: opts.label ? { text: opts.label } : undefined,
    input_type: opts.inputType ?? "text",
    initial_value: opts.initialValue,
    placeholder: opts.placeholder,
    max_length: opts.maxLength,
    max_row: opts.maxRow,
    required: opts.required,
  };
}

/** Build a Wave CardTimePicker element. No SDK helper exists. */
function buildCardTimePicker(
  name: string,
  opts: {
    label?: string;
    placeholder?: string;
    initialValue?: string;
    required?: boolean;
  },
): CardTimePicker {
  return {
    tag: CardTag.TimePicker,
    name,
    label: opts.label ? { text: opts.label } : undefined,
    initial_value: opts.initialValue,
    placeholder: opts.placeholder ?? "选择时间",
    required: opts.required,
  };
}

/** Build a Wave CardCheckboxGroup element. No SDK helper exists. */
function buildCardCheckboxGroup(
  name: string,
  opts: {
    label?: string;
    options: Array<{ text: string; value: string }>;
    initialValues?: string[];
    required?: boolean;
  },
): CardCheckboxGroup {
  return {
    tag: CardTag.CheckboxGroup,
    name,
    label: opts.label ? { text: opts.label } : undefined,
    options: opts.options,
    initial_values: opts.initialValues,
    required: opts.required,
  };
}

// ── Main Transform ───────────────────────────────────────────────────────────

/**
 * Convert a single JSON Schema field into a Wave card form element.
 */
function fieldToCardElement(
  name: string,
  field: AskUserFieldSchema,
  isRequired: boolean,
): Card {
  const label = field.title ?? name;

  // ── string ──
  if (field.type === "string") {
    // enum → select dropdown
    if (Array.isArray(field.enum) && field.enum.length > 0) {
      return cardSelectStatic(name, {
        label: { text: label },
        options: field.enum.map((v: any) => ({
          text: enumLabel(v, field.enumLabels),
          value: String(v),
        })),
        initial_value:
          field.default != null ? String(field.default) : undefined,
        placeholder: field.description ?? "请选择",
        required: isRequired,
      });
    }

    // date format → date picker
    if (field.format === "date") {
      return cardDatePicker(name, {
        label: { text: label },
        initial_value:
          field.default != null ? String(field.default) : undefined,
        placeholder: field.description ?? "选择日期",
        required: isRequired,
      });
    }

    // time format → time picker
    if (field.format === "time") {
      return buildCardTimePicker(name, {
        label,
        initialValue:
          field.default != null ? String(field.default) : undefined,
        placeholder: field.description ?? "选择时间",
        required: isRequired,
      });
    }

    // textarea format → multi-line input
    if (field.format === "textarea") {
      return buildCardInput(name, {
        label,
        inputType: "textarea",
        placeholder: field.description,
        initialValue:
          field.default != null ? String(field.default) : undefined,
        required: isRequired,
        maxRow: 5,
      });
    }

    // plain string → text input
    return buildCardInput(name, {
      label,
      inputType: "text",
      placeholder: field.description,
      initialValue:
        field.default != null ? String(field.default) : undefined,
      required: isRequired,
    });
  }

  // ── number ──
  if (field.type === "number") {
    return buildCardInput(name, {
      label,
      inputType: "text",
      placeholder: field.description ?? "输入数字",
      initialValue:
        field.default != null ? String(field.default) : undefined,
      required: isRequired,
    });
  }

  // ── boolean ──
  if (field.type === "boolean") {
    const defaultVal = field.default === true ? "true" : field.default === false ? "false" : undefined;
    return cardSelectStatic(name, {
      label: { text: label },
      options: [
        { text: "是", value: "true" },
        { text: "否", value: "false" },
      ],
      initial_value: defaultVal,
      placeholder: field.description ?? "请选择",
      required: isRequired,
    });
  }

  // ── array with items.enum → checkbox group ──
  if (
    field.type === "array" &&
    field.items &&
    Array.isArray(field.items.enum) &&
    field.items.enum.length > 0
  ) {
    return buildCardCheckboxGroup(name, {
      label,
      options: field.items.enum.map((v: any) => ({
        text: enumLabel(v, field.enumLabels),
        value: String(v),
      })),
      initialValues:
        Array.isArray(field.default)
          ? field.default.map(String)
          : undefined,
      required: isRequired,
    });
  }

  // Fallback: plain text input
  return buildCardInput(name, {
    label,
    inputType: "text",
    placeholder: field.description ?? `输入 ${label}`,
    required: isRequired,
  });
}

/**
 * Build a complete Wave form card from an askUser JSON Schema.
 *
 * Layout:
 *   header   (info template — shows the prompt message)
 *   form     [field elements...] [Submit button]
 */
export function buildAskUserFormCard(input: AskUserInput): MsgCard["content"] {
  const { message, schema } = input;
  const requiredSet = new Set(schema.required ?? []);

  const formElements: Card[] = [];

  // Add a prompt description if the message is rich
  if (message) {
    formElements.push(cardPlainText(message));
  }

  // Convert each property to a card element
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    formElements.push(fieldToCardElement(name, field, requiredSet.has(name)));
  }

  // Submit button
  formElements.push(
    cardButton("提交", cardOptionFormSubmit("submit", { verify: true }), {
      style: "primary",
    }),
  );

  return {
    header: cardHeader(message, "info"),
    card: cardForm(formElements),
  };
}

/**
 * Parse Wave form values back into typed values based on the original schema.
 *
 * Wave returns everything as strings or string arrays. This function
 * coerces values back to the types the LLM schema declared:
 *   - number fields → parseFloat
 *   - boolean fields → true/false
 *   - array fields → ensure array
 *   - string fields → keep as-is
 */
export function parseFormValues(
  formValues: Record<string, any>,
  schema: AskUserSchema,
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const raw = formValues[name];
    if (raw === undefined || raw === null) continue;

    switch (field.type) {
      case "number": {
        const str = Array.isArray(raw) ? raw[0] : raw;
        const num = parseFloat(String(str));
        result[name] = isNaN(num) ? str : num;
        break;
      }
      case "boolean": {
        const str = Array.isArray(raw) ? raw[0] : raw;
        result[name] = str === "true" || str === true;
        break;
      }
      case "array": {
        result[name] = Array.isArray(raw) ? raw : [raw];
        break;
      }
      default: {
        // For string with select_static, Wave returns an array with one element
        result[name] = Array.isArray(raw) ? raw[0] ?? raw : raw;
        break;
      }
    }
  }

  return result;
}
