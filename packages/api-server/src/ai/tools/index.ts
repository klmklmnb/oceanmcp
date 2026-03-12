import { getServerStatus, echo } from "./server-tools";
import { createBrowserExecuteTool } from "./browser-proxy-tool";
import { createExecutePlanTool } from "./execute-plan-tool";
import { userSelect } from "./user-select-tool";
import { imageOcr } from "./image-ocr-tool";
import { readPdf } from "./read-pdf-tool";
import type { ToolRetryTracker } from "./retry-tracker";
import {
  OPERATION_TYPE,
  PARAMETER_TYPE,
  isJSONSchemaParameters,
  type FunctionSchema,
  type FunctionParameters,
  type ParameterDefinition,
} from "@ocean-mcp/shared";
import { tool, jsonSchema, type Tool, type FlexibleSchema } from "ai";
import { z } from "zod";
import { connectionManager } from "../../ws/connection-manager";
import { createLoadSkillTool } from "../skills/loader";
import { getSkillsContext } from "../prompts";

/** Static tools that are always available */
export const serverTools = {
  userSelect,
  getServerStatus,
  echo,
  imageOcr,
  readPdf,
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

function deriveCandidateValuesFromDescription(description?: string): string[] {
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

  return dedupeStrings(candidates);
}

function getBrowserTools(
  connectionId?: string,
  retryTracker?: ToolRetryTracker,
): Record<string, Tool<any, any>> {
  return {
    browserExecute: createBrowserExecuteTool(connectionId, retryTracker),
    executePlan: createExecutePlanTool(connectionId, retryTracker),
  };
}

// Helper to convert legacy ParameterDefinition[] to Zod schema
export function createZodSchema(parameters: ParameterDefinition[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const param of parameters) {
    let schema: z.ZodTypeAny;
    const enumEntries = Object.entries(param.enumMap ?? {});
    const enumValues = enumEntries.map(([value]) => value);
    const inferredValues =
      param.type === PARAMETER_TYPE.STRING && enumEntries.length === 0
        ? deriveCandidateValuesFromDescription(param.description)
        : [];

    switch (param.type) {
      case PARAMETER_TYPE.STRING:
        schema =
          enumValues.length > 0
            ? z.enum(enumValues as [string, ...string[]])
            : z.string();
        break;
      case PARAMETER_TYPE.NUMBER:
        schema = z.number();
        break;
      case PARAMETER_TYPE.BOOLEAN:
        schema = z.boolean();
        break;
      case PARAMETER_TYPE.OBJECT:
        schema = z.any();
        break;
      case PARAMETER_TYPE.ARRAY: // deprecated — falls through to STRING_ARRAY
      case PARAMETER_TYPE.STRING_ARRAY:
        schema = z.array(z.string());
        break;
      case PARAMETER_TYPE.NUMBER_ARRAY:
        schema = z.array(z.number());
        break;
      case PARAMETER_TYPE.OBJECT_ARRAY:
        schema = z.array(z.record(z.any()));
        break;
      default:
        schema = z.any();
    }

    const enumDescription =
      enumEntries.length > 0
        ? `Allowed values: ${enumEntries
            .map(([value, label]) =>
              `${value}${label != null ? ` (${String(label)})` : ""}`,
            )
            .join(", ")}.`
        : "";

    const uncertainSelectionHint =
      param.type === PARAMETER_TYPE.STRING
        ? inferredValues.length > 0
          ? `Inferred candidate values: ${inferredValues.join(", ")}. If user intent is ambiguous, call userSelect with options derived from these values before setting this parameter.`
          : "If user intent is ambiguous, reason candidate options from context and this description, then call userSelect with explicit options before setting this parameter."
        : "";

    const description = [param.description, enumDescription, uncertainSelectionHint]
      .filter(Boolean)
      .join(" ");

    if (description) {
      schema = schema.describe(description);
    }

    if (!param.required) {
      schema = schema.optional();
    }

    shape[param.name] = schema;
  }

  return z.object(shape);
}

/**
 * Create an input schema for the Vercel AI SDK `tool()` function.
 *
 * Supports two parameter formats:
 * - `ParameterDefinition[]` (legacy) → builds a Zod schema via `createZodSchema()`
 * - `JSONSchemaParameters` (JSON Schema object) → wraps with the AI SDK's
 *   `jsonSchema()` function for native JSON Schema support
 *
 * @param parameters - Either a legacy ParameterDefinition array or a JSON Schema object
 * @returns A schema suitable for passing to `tool({ inputSchema: ... })`
 */
export function createInputSchema(parameters: FunctionParameters): FlexibleSchema<Record<string, any>> {
  if (isJSONSchemaParameters(parameters)) {
    // Use the AI SDK's native JSON Schema support.
    // Cast to Record<string, any> to satisfy the FlexibleSchema generic.
    return jsonSchema<Record<string, any>>(parameters as any);
  }
  // Legacy format — build Zod schema
  return createZodSchema(parameters);
}

/**
 * Create a browser-proxy tool wrapper for a given tool schema.
 * The tool's `execute` sends the call to the browser via WebSocket.
 *
 * For WRITE tools without `autoApprove`, the tool is created with
 * `needsApproval: true` so the Vercel AI SDK pauses for user approval
 * before executing. This prevents the LLM from directly invoking
 * write/mutation operations when the tool is registered as a native
 * tool (bypassing the `browserExecute` write guard).
 */
export function createBrowserProxyToolFromSchema(
  schema: FunctionSchema,
  connectionId?: string,
  retryTracker?: ToolRetryTracker,
): Tool<any, any> {
  const requiresApproval =
    schema.operationType === OPERATION_TYPE.WRITE && !schema.autoApprove;

  return tool({
    description: schema.description,
    inputSchema: createInputSchema(schema.parameters),
    ...(requiresApproval && { needsApproval: true }),
    execute: async (args: Record<string, any>) => {
      try {
        return await connectionManager.executeBrowserTool(
          schema.id,
          args,
          30_000,
          connectionId,
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);

        if (retryTracker) {
          const canRetry = retryTracker.recordFailure(schema.id);
          if (canRetry) {
            return {
              error: msg,
              functionId: schema.id,
              _retryHint: `Tool execution failed (attempt ${retryTracker.getAttempt(schema.id) - 1}/${retryTracker.max}). Analyze the error and retry with corrected parameters.`,
            };
          }
          return {
            error: msg,
            functionId: schema.id,
            _retryExhausted: true,
            _retryHint: `Tool execution failed and retry limit (${retryTracker.max}) reached. Report this error to the user and do NOT retry this tool.`,
          };
        }

        throw error;
      }
    },
  });
}

/**
 * Merge all tools for a streamText call.
 * Combines server tools + browser proxy tools + dynamic tools from the frontend
 * registry + the loadSkill tool + skill-bundled tools from both file-based and
 * frontend-registered skills.
 *
 * Tool priority (collision avoidance — first defined wins):
 *   1. Built-in server tools (userSelect, etc.)
 *   2. Browser proxy tools (browserExecute, executePlan)
 *   3. loadSkill tool (when any skills exist)
 *   4. File-based skill-bundled tools (from skills' tools.ts exports)
 *   5. Frontend skill-bundled tools (from SkillSchema.tools)
 *   6. Standalone dynamic tools from frontend registry (via WebSocket)
 */
export function getMergedTools(
  dynamicToolSchemas?: FunctionSchema[],
  connectionId?: string,
  retryTracker?: ToolRetryTracker,
): Record<string, Tool<any, any>> {
  const tools: Record<string, Tool<any, any>> = {
    userSelect,
    imageOcr,
    readPdf,
    // ...serverTools,
    ...getBrowserTools(connectionId, retryTracker),
  };

  // ── Skills integration ─────────────────────────────────────────────────
  const { sandbox, skills: fileSkills } = getSkillsContext(connectionId);
  const frontendSkillSchemas = connectionManager.getSkillSchemas(connectionId);

  const hasAnySkills = fileSkills.length > 0 || frontendSkillSchemas.length > 0;

  if (hasAnySkills) {
    // The loadSkill tool allows the LLM to load full skill instructions
    // on-demand (progressive disclosure pattern). It resolves both
    // file-based and frontend-registered skills.
    tools.loadSkill = createLoadSkillTool(
      sandbox,
      fileSkills,
      frontendSkillSchemas,
    );

    // Merge tools exported by file-based skill directories (from tools.ts files).
    // Skip if the tool name already exists (collision avoidance).
    for (const skill of fileSkills) {
      if (!skill.tools) continue;
      for (const [name, skillTool] of Object.entries(skill.tools)) {
        if (tools[name]) continue; // Built-in tools take priority
        tools[name] = skillTool;
      }
    }

    // Merge tools bundled inside frontend-registered skills.
    // These are browser-proxy tools — executed via WebSocket, same as
    // standalone dynamic tools.
    for (const skillSchema of frontendSkillSchemas) {
      if (!skillSchema.tools) continue;
      for (const toolSchema of skillSchema.tools) {
        if (tools[toolSchema.id]) continue; // Collision avoidance
        tools[toolSchema.id] = createBrowserProxyToolFromSchema(
          toolSchema,
          connectionId,
          retryTracker,
        );
      }
    }
  }

  // If dynamic tool schemas are provided from the frontend,
  // we register them as native tools for the LLM.
  if (dynamicToolSchemas && dynamicToolSchemas.length > 0) {
    for (const schema of dynamicToolSchemas) {
      // Skip if already defined (collision avoidance)
      if (tools[schema.id]) continue;

      tools[schema.id] = createBrowserProxyToolFromSchema(
        schema,
        connectionId,
        retryTracker,
      );
    }
  }

  return tools;
}
