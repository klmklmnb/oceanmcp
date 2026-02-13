import { getServerStatus, echo } from "./server-tools";
import { createBrowserExecuteTool } from "./browser-proxy-tool";
import { createExecutePlanTool } from "./execute-plan-tool";
import { userSelect } from "./user-select-tool";
import {
  PARAMETER_TYPE,
  type FunctionSchema,
  type ParameterDefinition,
} from "@ocean-mcp/shared";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { connectionManager } from "../../ws/connection-manager";
import { createLoadSkillTool } from "../skills/loader";
import { getSkillsContext } from "../prompts";

/** Static tools that are always available */
export const serverTools = {
  userSelect,
  getServerStatus,
  echo,
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
): Record<string, Tool<any, any>> {
  return {
    browserExecute: createBrowserExecuteTool(connectionId),
    executePlan: createExecutePlanTool(connectionId),
  };
}

// Helper to convert parameter definitions to Zod schema
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
      case PARAMETER_TYPE.ARRAY:
        schema = z.array(z.any());
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
 * Merge all tools for a streamText call.
 * Combines server tools + browser proxy tools + dynamic tools from the frontend
 * registry + the loadSkill tool + any tools bundled by discovered skills.
 *
 * Tool priority (collision avoidance — first defined wins):
 *   1. Built-in server tools (userSelect, etc.)
 *   2. Browser proxy tools (browserExecute, executePlan)
 *   3. loadSkill tool (when skills are discovered)
 *   4. Skill-bundled tools (from skills' tools.ts exports)
 *   5. Dynamic tools from frontend registry (via WebSocket)
 */
export function getMergedTools(
  dynamicToolSchemas?: FunctionSchema[],
  connectionId?: string,
): Record<string, Tool<any, any>> {
  const tools: Record<string, Tool<any, any>> = {
    userSelect,
    // ...serverTools,
    ...getBrowserTools(connectionId),
  };

  // ── Skills integration ─────────────────────────────────────────────────
  // Add the loadSkill tool and merge skill-bundled tools when skills exist.
  const { sandbox, skills } = getSkillsContext();

  if (skills.length > 0) {
    // The loadSkill tool allows the LLM to load full skill instructions
    // on-demand (progressive disclosure pattern).
    tools.loadSkill = createLoadSkillTool(sandbox, skills);

    // Merge tools exported by skill directories (from tools.ts files).
    // Skip if the tool name already exists (collision avoidance).
    for (const skill of skills) {
      if (!skill.tools) continue;
      for (const [name, skillTool] of Object.entries(skill.tools)) {
        if (tools[name]) continue; // Built-in tools take priority
        tools[name] = skillTool;
      }
    }
  }

  // If dynamic tool schemas are provided from the frontend,
  // we register them as native tools for the LLM.
  if (dynamicToolSchemas && dynamicToolSchemas.length > 0) {
    for (const schema of dynamicToolSchemas) {
      // Skip if already defined (collision avoidance)
      if (tools[schema.id]) continue;

      tools[schema.id] = tool({
        description: schema.description,
        inputSchema: createZodSchema(schema.parameters),
        execute: async (args) => {
          return connectionManager.executeBrowserTool(
            schema.id,
            args,
            30_000,
            connectionId,
          );
        },
      });
    }
  }

  return tools;
}
