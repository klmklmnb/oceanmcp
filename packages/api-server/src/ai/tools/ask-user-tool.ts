import { tool } from "ai";
import { z } from "zod";

/**
 * JSON Schema field definition that the LLM produces for each form field.
 *
 * Supported types and their rendering:
 *   - string                       → text input
 *   - string + enum                → select / radio buttons
 *   - string + format:"date"       → date picker
 *   - string + format:"time"       → time picker
 *   - string + format:"textarea"   → multi-line textarea
 *   - number                       → number input
 *   - boolean                      → toggle / yes-no buttons
 *   - array  + items.enum          → checkbox group (multi-select)
 */
const fieldSchema = z
  .object({
    type: z
      .enum(["string", "number", "boolean", "array"])
      .describe("Field type."),
    title: z
      .string()
      .optional()
      .describe("Human-readable label shown next to the field."),
    description: z
      .string()
      .optional()
      .describe("Help text or placeholder for the field."),
    enum: z
      .array(z.any())
      .optional()
      .describe(
        "Allowed values — renders as select dropdown (>3) or radio/buttons (≤3).",
      ),
    enumLabels: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Map of enum value → human-readable label, e.g. {"prod": "Production"}.',
      ),
    default: z.any().optional().describe("Default value for the field."),
    items: z
      .object({
        type: z.string().optional(),
        enum: z.array(z.any()).optional(),
      })
      .optional()
      .describe(
        "For array type: item schema. If items.enum is provided, renders as checkbox group.",
      ),
    format: z
      .string()
      .optional()
      .describe(
        'Format hint: "date" for date picker, "time" for time picker, "textarea" for multi-line input.',
      ),
  })
  .passthrough();

const formSchemaObject = z.object({
  type: z.literal("object"),
  properties: z
    .record(z.string(), fieldSchema)
    .describe("Field definitions keyed by field name."),
  required: z
    .array(z.string())
    .optional()
    .describe("Names of required fields."),
});

/**
 * `askUser` — general-purpose interactive input tool.
 *
 * The LLM calls this tool whenever it needs user input before continuing.
 * It supports everything from simple single-select choices to multi-field
 * forms via a standard JSON Schema object.
 *
 * **Client-side tool** (no `execute`): the frontend renders the form and
 * returns the filled values via `addToolResult`. For the Wave channel, the
 * server-side variant in `wave/tools.ts` provides its own `execute()` that
 * sends an interactive Wave card.
 */
export const askUser = tool({
  description:
    "Ask the user for input before continuing. ALWAYS prefer this tool over asking " +
    "questions in plain text — it provides a much better interactive experience " +
    "(form fields, dropdowns, date pickers, checkboxes, etc.). Use this whenever " +
    "you need the user to provide values, make choices, confirm information, or " +
    "answer questions. Provide a JSON Schema describing the fields you need.",
  inputSchema: z.object({
    message: z
      .string()
      .describe("Prompt or title text shown to the user above the form."),
    schema: formSchemaObject.describe(
      'JSON Schema (type:"object") describing the form fields the user should fill in.',
    ),
  }),
});
