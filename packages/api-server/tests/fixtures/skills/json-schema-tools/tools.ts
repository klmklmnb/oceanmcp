/**
 * Test fixture: JSON Schema parameter tools.
 *
 * Mixed format — includes both a CodeFunctionDefinition with JSON Schema
 * parameters and a Vercel AI SDK Tool with JSON Schema, alongside a
 * legacy CodeFunctionDefinition for backward-compat testing.
 */
import { tool, jsonSchema } from "ai";

export default {
  /**
   * CodeFunctionDefinition with JSON Schema parameters.
   * Tests that `isCodeFunctionDefinition()` + `wrapCodeFunctionAsTool()`
   * correctly handle JSON Schema params.
   */
  greetUser: {
    id: "greetUser",
    name: "Greet User",
    description: "Generate a personalized greeting",
    type: "code",
    operationType: "read",
    code: `
      const { name, language, formal } = args;
      const greetings = {
        en: formal ? "Dear " + name + "," : "Hey " + name + "!",
        zh: formal ? name + "先生/女士，您好" : name + "，你好！",
        ja: formal ? name + "様" : name + "さん",
      };
      return { greeting: greetings[language] || greetings.en };
    `,
    parameters: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          description: "Name of the person to greet",
          minLength: 1,
          maxLength: 100,
        },
        language: {
          type: "string",
          description: "Language for the greeting",
          enum: ["en", "zh", "ja"],
          default: "en",
        },
        formal: {
          type: "boolean",
          description: "Whether to use formal greeting style",
          default: false,
        },
      },
      additionalProperties: false,
    },
  },

  /**
   * Vercel AI SDK Tool with JSON Schema input (via jsonSchema()).
   */
  processOrder: tool({
    description: "Process an order with items and shipping details",
    inputSchema: jsonSchema<{
      orderId: string;
      items: Array<{ productId: string; quantity: number; price: number }>;
      shippingAddress: { street: string; city: string; country: string };
    }>({
      type: "object",
      required: ["orderId", "items", "shippingAddress"],
      properties: {
        orderId: {
          type: "string",
          description: "Unique order identifier",
          pattern: "^ORD-[0-9]+$",
        },
        items: {
          type: "array",
          description: "Order items",
          items: {
            type: "object",
            required: ["productId", "quantity", "price"],
            properties: {
              productId: { type: "string" },
              quantity: { type: "number", minimum: 1 },
              price: { type: "number", minimum: 0 },
            },
          },
          minItems: 1,
        },
        shippingAddress: {
          type: "object",
          description: "Delivery address",
          required: ["street", "city", "country"],
          properties: {
            street: { type: "string" },
            city: { type: "string" },
            country: { type: "string" },
          },
        },
      },
      additionalProperties: false,
    }),
    execute: async ({ orderId, items, shippingAddress }) => {
      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      return {
        orderId,
        status: "confirmed",
        itemCount: items.length,
        total: Math.round(total * 100) / 100,
        shippingTo: `${shippingAddress.street}, ${shippingAddress.city}, ${shippingAddress.country}`,
      };
    },
  }),

  /**
   * Legacy CodeFunctionDefinition with ParameterDefinition[] — ensures
   * backward compatibility still works in the same tools.ts file.
   */
  legacyEcho: {
    id: "legacyEcho",
    name: "Legacy Echo",
    description: "Echo with legacy parameters (backward compat test)",
    type: "code",
    operationType: "read",
    code: 'return { echo: args.message }',
    parameters: [
      {
        name: "message",
        type: "string",
        description: "Message to echo",
        required: true,
      },
    ],
  },
};
