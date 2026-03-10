/**
 * Math utility tools — CodeFunctionDefinition format.
 *
 * These tools run server-side via new Function() execution.
 * They demonstrate pure computation tools that don't need
 * browser globals (no window/document/fetch required).
 */
export default {
  calculate: {
    id: "calculate",
    name: "Calculate",
    description:
      "Evaluate a math expression with two numbers. " +
      "Supports operations: add, subtract, multiply, divide.",
    type: "code",
    operationType: "read",
    code: `
      const { a, b, operation } = args;
      switch (operation) {
        case "add": return { result: a + b, expression: a + " + " + b + " = " + (a + b) };
        case "subtract": return { result: a - b, expression: a + " - " + b + " = " + (a - b) };
        case "multiply": return { result: a * b, expression: a + " × " + b + " = " + (a * b) };
        case "divide":
          if (b === 0) return { error: "Division by zero" };
          return { result: a / b, expression: a + " ÷ " + b + " = " + (a / b) };
        default: return { error: "Unknown operation: " + operation };
      }
    `,
    parameters: [
      {
        name: "a",
        type: "number",
        description: "First operand",
        required: true,
      },
      {
        name: "b",
        type: "number",
        description: "Second operand",
        required: true,
      },
      {
        name: "operation",
        type: "string",
        description:
          'Math operation to perform: "add", "subtract", "multiply", or "divide"',
        required: true,
        enumMap: {
          add: "Addition (+)",
          subtract: "Subtraction (-)",
          multiply: "Multiplication (×)",
          divide: "Division (÷)",
        },
      },
    ],
  },

  statistics: {
    id: "statistics",
    name: "Compute Statistics",
    description:
      "Compute basic statistics (mean, median, min, max, sum, count) " +
      "for an array of numbers.",
    type: "code",
    operationType: "read",
    code: `
      const numbers = args.numbers;
      if (!numbers || numbers.length === 0) {
        return { error: "No numbers provided" };
      }
      const sorted = [...numbers].sort((a, b) => a - b);
      const sum = numbers.reduce((s, n) => s + n, 0);
      const mean = sum / numbers.length;
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;

      return {
        count: numbers.length,
        sum: sum,
        mean: mean,
        median: median,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        range: sorted[sorted.length - 1] - sorted[0],
      };
    `,
    parameters: [
      {
        name: "numbers",
        type: "number_array",
        description: "Array of numbers to analyze",
        required: true,
      },
    ],
  },

  formatNumber: {
    id: "formatNumber",
    name: "Format Number",
    description:
      "Format a number with locale-specific separators, " +
      "optional decimal places, and optional prefix/suffix.",
    type: "code",
    operationType: "read",
    code: `
      const { value, decimals, prefix, suffix } = args;
      const fixed = decimals !== undefined ? value.toFixed(decimals) : String(value);
      // Simple thousands separator (works without Intl)
      const parts = fixed.split(".");
      parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
      const formatted = parts.join(".");
      return {
        original: value,
        formatted: (prefix || "") + formatted + (suffix || ""),
      };
    `,
    parameters: [
      {
        name: "value",
        type: "number",
        description: "The number to format",
        required: true,
      },
      {
        name: "decimals",
        type: "number",
        description: "Number of decimal places (optional)",
        required: false,
      },
      {
        name: "prefix",
        type: "string",
        description: 'Prefix to prepend (e.g. "$", "¥")',
        required: false,
      },
      {
        name: "suffix",
        type: "string",
        description: 'Suffix to append (e.g. "%", " USD")',
        required: false,
      },
    ],
  },
};
