import { tool } from "ai";
import { z } from "zod";

/**
 * Client-side interaction tool.
 * The LLM calls this tool when it needs the user to choose a value from
 * candidate options. The frontend renders a picker and returns the selected
 * value via addToolOutput.
 */
export const userSelect = tool({
  description:
    "Ask the user to select one option before continuing. Use this whenever a value is uncertain and there are known or inferred candidate options.",
  inputSchema: z
    .object({
      functionId: z
        .string()
        .optional()
        .describe(
          "Optional target tool ID. Use with parameterName to resolve option metadata from the target tool.",
        ),
      parameterName: z
        .string()
        .optional()
        .describe(
          "Optional target parameter name on functionId. Used to resolve enumMap/display hints when explicit options are not provided.",
        ),
      message: z
        .string()
        .optional()
        .describe("Optional prompt text shown to the user."),
      defaultValue: z
        .any()
        .optional()
        .describe(
          "Optional default value to pre-select. The option whose value matches will be highlighted/pre-selected in the card.",
        ),
      options: z
        .array(
          z.object({
            value: z.any().describe("The raw option value."),
            label: z
              .string()
              .optional()
              .describe("Optional user-facing option label."),
            description: z
              .string()
              .optional()
              .describe("Optional extra detail shown with the option."),
          }),
        )
        .optional()
        .describe(
          "Explicit candidate options. For non-enum parameters, prefer providing this after reasoning candidates from context/descriptions.",
        ),
    })
    .refine(
      (input) =>
        (Array.isArray(input.options) && input.options.length > 0) ||
        Boolean(input.functionId && input.parameterName),
      {
        message:
          "Provide either non-empty options, or both functionId and parameterName.",
      },
    ),
});
