/**
 * Environment deployment tools — demonstrates askUser integration.
 *
 * These tools are Vercel AI SDK Tool format. They showcase a pattern where
 * a tool's execute() triggers the `askUser` tool by returning a
 * structured result that tells the LLM to call askUser next.
 *
 * In practice, the LLM decides to call askUser based on the tool's
 * description and the ambiguity of the user's request. These tools
 * provide the option metadata for the LLM to pass to askUser.
 */
import { tool } from "ai";
import { z } from "zod";

export default {
  /**
   * Deploy tool — the LLM is instructed to call askUser first
   * if the target environment is ambiguous. The tool's description
   * guides the LLM to present environment choices to the user.
   */
  deploy: tool({
    description:
      "Deploy the current project to a target environment. " +
      "If the user has not specified an environment, call askUser first " +
      "with the available environments: dev, staging, production. " +
      "Only proceed with deploy after the user has confirmed the target.",
    inputSchema: z.object({
      environment: z
        .string()
        .describe(
          'Target environment: "dev", "staging", or "production"',
        ),
      version: z
        .string()
        .optional()
        .describe("Optional version tag to deploy (defaults to latest)"),
    }),
    execute: async ({ environment, version }) => {
      const validEnvs = ["dev", "staging", "production"];
      if (!validEnvs.includes(environment)) {
        return {
          error: `Invalid environment: ${environment}. Must be one of: ${validEnvs.join(", ")}`,
          hint: "Call askUser with the valid environment options.",
        };
      }
      return {
        status: "deployed",
        environment,
        version: version ?? "latest",
        timestamp: new Date().toISOString(),
        url: `https://${environment}.example.com`,
      };
    },
  }),

  /**
   * Rollback tool — demonstrates a scenario with >3 options.
   */
  rollback: tool({
    description:
      "Rollback a deployment to a previous version. " +
      "If the user has not specified a version, call askUser first " +
      "with the available versions: v1.0.0, v1.1.0, v1.2.0, v1.3.0, v2.0.0. " +
      "Only proceed with rollback after the user has confirmed the version.",
    inputSchema: z.object({
      environment: z
        .string()
        .describe('Target environment: "dev", "staging", or "production"'),
      version: z
        .string()
        .describe("The version to rollback to"),
    }),
    execute: async ({ environment, version }) => {
      return {
        status: "rolled_back",
        environment,
        previousVersion: version,
        timestamp: new Date().toISOString(),
      };
    },
  }),
};
