/**
 * Shipping calculator tools — demonstrates JSON Schema parameter format.
 *
 * These tools use the new `JSONSchemaParameters` format instead of the
 * legacy `ParameterDefinition[]` array. This demonstrates:
 *
 * - Nested object properties (package dimensions, insurance options)
 * - Number constraints (minimum, maximum)
 * - String enums (service levels)
 * - Array items with typed schemas
 * - Default values
 * - Pattern matching (tracking number format)
 *
 * The first tool (`calculateShippingCost`) is a CodeFunctionDefinition
 * with JSON Schema parameters. The second (`trackShipment`) is a Vercel
 * AI SDK tool also using JSON Schema via `jsonSchema()`.
 */
import { tool, jsonSchema } from "ai";

export default {
  /**
   * Calculate shipping cost — CodeFunctionDefinition with JSON Schema params.
   *
   * Demonstrates that `isCodeFunctionDefinition()` correctly detects
   * tools with JSON Schema parameters (not just legacy arrays).
   */
  calculateShippingCost: {
    id: "calculateShippingCost",
    name: "Calculate Shipping Cost",
    description:
      "Calculate the shipping cost for a package based on weight, dimensions, " +
      "destination, and service level. Returns cost breakdown and estimated delivery time.",
    type: "code",
    operationType: "read",
    code: `
      const { weight, dimensions, destination, serviceLevel, insurance } = args;

      // Calculate volumetric weight (L×W×H / 5000)
      const volWeight = dimensions
        ? (dimensions.length * dimensions.width * dimensions.height) / 5000
        : 0;
      const chargeableWeight = Math.max(weight, volWeight);

      // Base rates per service level
      const rates = { standard: 5, express: 12, overnight: 25 };
      const rate = rates[serviceLevel] || rates.standard;

      const baseCost = chargeableWeight * rate;
      const insuranceCost = insurance?.enabled
        ? (insurance.declaredValue || 0) * 0.02
        : 0;
      const totalCost = Math.round((baseCost + insuranceCost) * 100) / 100;

      const deliveryDays = {
        standard: "5-7 business days",
        express: "2-3 business days",
        overnight: "Next business day",
      };

      return {
        chargeableWeight: Math.round(chargeableWeight * 100) / 100,
        actualWeight: weight,
        volumetricWeight: Math.round(volWeight * 100) / 100,
        destination,
        serviceLevel: serviceLevel || "standard",
        baseCost: Math.round(baseCost * 100) / 100,
        insuranceCost,
        totalCost,
        currency: "USD",
        estimatedDelivery: deliveryDays[serviceLevel] || deliveryDays.standard,
      };
    `,
    parameters: {
      type: "object",
      required: ["weight", "destination"],
      properties: {
        weight: {
          type: "number",
          description: "Package weight in kilograms",
          minimum: 0.01,
          maximum: 100,
        },
        dimensions: {
          type: "object",
          description: "Package dimensions in centimeters",
          properties: {
            length: {
              type: "number",
              description: "Length in cm",
              minimum: 1,
              maximum: 300,
            },
            width: {
              type: "number",
              description: "Width in cm",
              minimum: 1,
              maximum: 300,
            },
            height: {
              type: "number",
              description: "Height in cm",
              minimum: 1,
              maximum: 300,
            },
          },
          required: ["length", "width", "height"],
          additionalProperties: false,
        },
        destination: {
          type: "string",
          description: "Destination country or city",
        },
        serviceLevel: {
          type: "string",
          description: "Shipping service level",
          enum: ["standard", "express", "overnight"],
          default: "standard",
        },
        insurance: {
          type: "object",
          description: "Optional shipping insurance",
          properties: {
            enabled: {
              type: "boolean",
              description: "Whether to add insurance",
              default: false,
            },
            declaredValue: {
              type: "number",
              description: "Declared value of package contents in USD",
              minimum: 0,
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },

  /**
   * Track shipment — Vercel AI SDK tool with JSON Schema params.
   *
   * Demonstrates using `jsonSchema()` directly in a tool definition
   * within a skill's tools.ts file.
   */
  trackShipment: tool({
    description:
      "Track a shipment by its tracking number. Returns current status, " +
      "location, and delivery history.",
    inputSchema: jsonSchema<{ trackingNumber: string; carrier?: string }>({
      type: "object",
      required: ["trackingNumber"],
      properties: {
        trackingNumber: {
          type: "string",
          description: "The shipment tracking number",
          pattern: "^[A-Z0-9]{10,30}$",
        },
        carrier: {
          type: "string",
          description: "Carrier name (auto-detected if omitted)",
          enum: ["fedex", "ups", "dhl", "usps"],
        },
      },
      additionalProperties: false,
    }),
    execute: async ({ trackingNumber, carrier }) => {
      // Simulated tracking response
      return {
        trackingNumber,
        carrier: carrier || "auto-detected",
        status: "in_transit",
        currentLocation: "Distribution Center, Shanghai",
        estimatedDelivery: new Date(
          Date.now() + 3 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        history: [
          {
            timestamp: new Date(
              Date.now() - 2 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            location: "Origin Facility, Shenzhen",
            status: "picked_up",
          },
          {
            timestamp: new Date(
              Date.now() - 1 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            location: "Sorting Center, Guangzhou",
            status: "in_transit",
          },
          {
            timestamp: new Date().toISOString(),
            location: "Distribution Center, Shanghai",
            status: "in_transit",
          },
        ],
      };
    },
  }),
};
