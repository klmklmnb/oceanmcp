/**
 * Mixed tools demo — exports both Vercel AI SDK Tool and CodeFunctionDefinition
 * objects from the same default export.
 *
 * The skill system auto-detects each entry:
 *   - Objects with { type: "code", code: "...", ... } → CodeFunctionDefinition → wrapped
 *   - Objects with { description, inputSchema, execute } → AI SDK Tool → passed through
 */
import { tool } from "ai";
import { z } from "zod";

export default {
  // ── Vercel AI SDK Tool (native) ──────────────────────────────────────
  echo: tool({
    description:
      "Echo back the provided text with metadata. " +
      "Returns the text, its length, and a timestamp.",
    inputSchema: z.object({
      text: z.string().describe("The text to echo back"),
      uppercase: z
        .boolean()
        .optional()
        .describe("If true, convert the text to uppercase"),
    }),
    execute: async ({ text, uppercase }) => {
      const output = uppercase ? text.toUpperCase() : text;
      return {
        echo: output,
        length: output.length,
        timestamp: new Date().toISOString(),
      };
    },
  }),

  // ── CodeFunctionDefinition (auto-wrapped) ────────────────────────────
  encodeBase64: {
    id: "encodeBase64",
    name: "Encode Base64",
    description: "Encode a text string to Base64 format.",
    type: "code",
    operationType: "read",
    code: `
      const encoded = btoa(unescape(encodeURIComponent(args.text)));
      return { original: args.text, encoded };
    `,
    parameters: [
      {
        name: "text",
        type: "string",
        description: "The text to encode",
        required: true,
      },
    ],
  },

  decodeBase64: {
    id: "decodeBase64",
    name: "Decode Base64",
    description: "Decode a Base64 string back to text.",
    type: "code",
    operationType: "read",
    code: `
      try {
        const decoded = decodeURIComponent(escape(atob(args.encoded)));
        return { encoded: args.encoded, decoded };
      } catch (e) {
        return { error: "Invalid Base64 input: " + e.message };
      }
    `,
    parameters: [
      {
        name: "encoded",
        type: "string",
        description: "The Base64-encoded string to decode",
        required: true,
      },
    ],
  },

  generateUUID: {
    id: "generateUUID",
    name: "Generate UUID",
    description:
      "Generate a random UUID v4 string. " +
      "Optionally generate multiple UUIDs at once.",
    type: "code",
    operationType: "read",
    code: `
      function uuid() {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === "x" ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }
      const count = args.count || 1;
      const uuids = Array.from({ length: count }, () => uuid());
      return count === 1 ? { uuid: uuids[0] } : { uuids, count };
    `,
    parameters: [
      {
        name: "count",
        type: "number",
        description: "Number of UUIDs to generate (default: 1)",
        required: false,
      },
    ],
  },
};
