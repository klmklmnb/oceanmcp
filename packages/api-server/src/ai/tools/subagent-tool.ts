/**
 * Subagent tool — delegates tasks to autonomous sub-agents that run in
 * isolated context windows with read-only tool access.
 *
 * ## How It Works
 *
 * 1. The main agent calls the `subagent` tool with a `task` and `systemPrompt`.
 * 2. A `ToolLoopAgent` is created on the fly with:
 *    - The configured subagent model (or the main model as fallback)
 *    - A **read-only** subset of the main agent's tools
 *    - The provided `systemPrompt` as instructions
 * 3. The subagent streams its execution via `readUIMessageStream`, yielding
 *    preliminary `UIMessage` updates to the frontend (text, tool calls,
 *    reasoning — rendered inside a SubagentCard).
 * 4. `toModelOutput` compresses the full execution trace into just the
 *    subagent's final text response, keeping the main agent's context lean.
 *
 * ## Read-Only Constraint
 *
 * Subagents are restricted to read operations only:
 *   - Server-side read tools: imageOcr, readPdf, loadSkill
 *   - Browser-side tools with operationType === "read"
 *   - Skill-bundled tools that do NOT have needsApproval
 *
 * Write tools, askUser, executePlan, browserExecute, and the subagent tool
 * itself are all excluded to prevent mutation, user interaction, and recursion.
 *
 * ## Configuration (env vars)
 *
 *   SUBAGENT_ENABLED      — master kill switch (default: "true")
 *   SUBAGENT_MODEL        — model ID for subagents (default: same as main model)
 *   SUBAGENT_TIMEOUT_MS   — per-invocation timeout in ms (default: 120000)
 *   SUBAGENT_MAX_STEPS    — max LLM steps per subagent (default: 30)
 *   SUBAGENT_MAX_PARALLEL — max concurrent subagents per chat request (default: 5)
 */

import {
  tool,
  ToolLoopAgent,
  readUIMessageStream,
  stepCountIs,
  type Tool,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import { OPERATION_TYPE, type FunctionSchema, type SkillSchema, type ModelConfig } from "oceanmcp-shared";
import { getLanguageModel } from "../providers";
import { logger } from "../../logger";

// ── Configuration ────────────────────────────────────────────────────────────

/** Server-level master kill switch for the subagent feature. */
export const SUBAGENT_SERVER_ENABLED =
  (process.env.SUBAGENT_ENABLED ?? "true").toLowerCase() !== "false";

const SUBAGENT_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.SUBAGENT_TIMEOUT_MS) || 120_000,
);

const SUBAGENT_MAX_STEPS = Math.max(
  1,
  Number(process.env.SUBAGENT_MAX_STEPS) || 30,
);

/** Maximum number of concurrent subagent invocations per chat request. */
const SUBAGENT_MAX_PARALLEL = Math.max(
  1,
  Number(process.env.SUBAGENT_MAX_PARALLEL) || 5,
);

// ── Read-only tool filtering ─────────────────────────────────────────────────

/**
 * Tools that are always blocked from subagents regardless of operationType.
 *
 * - subagent:       prevent recursion
 * - askUser:        requires user interaction (subagents are autonomous)
 * - executePlan:    write-only by design (multi-step mutation plans)
 * - browserExecute: generic proxy that can reach write tools; replaced by
 *                   individual read-only browser proxy tools
 */
const BLOCKED_TOOL_NAMES = new Set([
  "subagent",
  "askUser",
  "executePlan",
  "browserExecute",
]);

/**
 * Server-side tools that are known to be read-only and safe for subagents.
 * These tools don't carry an `operationType` field because they are bare
 * `tool()` objects — we allow-list them explicitly.
 */
const ALLOWED_SERVER_TOOLS = new Set([
  "imageOcr",
  "readPdf",
  "loadSkill",
]);

/**
 * Build a read-only tool subset for a subagent.
 *
 * Filtering rules:
 *   1. Remove all BLOCKED_TOOL_NAMES
 *   2. Allow explicit ALLOWED_SERVER_TOOLS (known read-only server tools)
 *   3. For browser-proxy tools (those with a matching FunctionSchema):
 *      - Include only if schema.operationType === "read"
 *   4. For skill-bundled tools:
 *      - Include only if the tool does NOT have `needsApproval`
 *        (needsApproval indicates a write/mutation tool)
 *   5. Any remaining tool not matched by the above checks is included
 *      (defensive: unknown tools are assumed safe — the main agent already
 *       controls what tools exist)
 */
/** @internal Exported for testing only. */
export function filterReadOnlyTools(
  allTools: Record<string, Tool<any, any>>,
  toolSchemas: FunctionSchema[],
  skillSchemas: SkillSchema[],
): Record<string, Tool<any, any>> {
  // Build lookup maps for quick schema resolution
  const schemaById = new Map<string, FunctionSchema>();
  for (const schema of toolSchemas) {
    schemaById.set(schema.id, schema);
  }
  for (const skill of skillSchemas) {
    if (!skill.tools) continue;
    for (const toolSchema of skill.tools) {
      // Don't overwrite standalone schemas (they take priority)
      if (!schemaById.has(toolSchema.id)) {
        schemaById.set(toolSchema.id, toolSchema);
      }
    }
  }

  // Set of tool names that have needsApproval (write tools from skills)
  const writeToolNames = new Set<string>();
  for (const [name, t] of Object.entries(allTools)) {
    const raw = (t as any).needsApproval;
    if (raw === true || typeof raw === "function") {
      writeToolNames.add(name);
    }
  }

  const filtered: Record<string, Tool<any, any>> = {};

  for (const [name, t] of Object.entries(allTools)) {
    // 1. Always blocked
    if (BLOCKED_TOOL_NAMES.has(name)) continue;

    // 2. Explicitly allowed server tools
    if (ALLOWED_SERVER_TOOLS.has(name)) {
      filtered[name] = t;
      continue;
    }

    // 3. Check schema for browser-proxy tools
    const schema = schemaById.get(name);
    if (schema) {
      if (schema.operationType === OPERATION_TYPE.READ) {
        filtered[name] = t;
      }
      // operationType === "write" → skip
      continue;
    }

    // 4. Skip write tools (identified by needsApproval)
    if (writeToolNames.has(name)) continue;

    // 5. Unknown tool with no schema and no needsApproval — include it
    // (e.g. a server-side tool not in our allowlist but also not a write tool)
    filtered[name] = t;
  }

  return filtered;
}

// ── Subagent tool factory ────────────────────────────────────────────────────

/**
 * Options passed from the frontend SDK for subagent configuration.
 * These override the corresponding server env vars when provided.
 */
export interface SubagentToolOptions {
  /**
   * LLM model configuration for subagents from the frontend.
   * When provided, overrides `SUBAGENT_MODEL` env var.
   */
  subagentModel?: ModelConfig;
  /**
   * Maximum execution time per subagent invocation in milliseconds.
   * When provided, overrides `SUBAGENT_TIMEOUT_MS` env var.
   */
  subagentTimeoutMs?: number;
  /**
   * Maximum number of concurrent subagent invocations per chat request.
   * When provided, overrides `SUBAGENT_MAX_PARALLEL` env var.
   */
  maxParallel?: number;
}

/**
 * Create the `subagent` tool for the main agent.
 *
 * The tool uses an async generator (`async function*`) to stream preliminary
 * `UIMessage` updates to the frontend via the Vercel AI SDK's preliminary
 * tool results mechanism.
 *
 * @param mainModel     - The main agent's model (used as fallback if no subagent model is configured)
 * @param allTools      - Reference to the full merged tool set (lazy-evaluated in execute)
 * @param toolSchemas   - Browser-side tool schemas (for operationType checking)
 * @param skillSchemas  - Skill schemas (for skill-bundled tool schema lookup)
 * @param options       - Optional frontend-provided overrides for model/timeout
 */
export function createSubagentTool(
  mainModel: LanguageModel,
  allTools: Record<string, Tool<any, any>>,
  toolSchemas: FunctionSchema[],
  skillSchemas: SkillSchema[],
  options?: SubagentToolOptions,
): Tool<any, any> {
  // Resolve timeout: frontend override → server env → default
  const effectiveTimeoutMs = options?.subagentTimeoutMs != null && options.subagentTimeoutMs > 0
    ? Math.max(5_000, options.subagentTimeoutMs)
    : SUBAGENT_TIMEOUT_MS;

  // Resolve max parallel: frontend override → server env → default (5)
  const maxParallel = options?.maxParallel != null && options.maxParallel > 0
    ? options.maxParallel
    : SUBAGENT_MAX_PARALLEL;

  // Shared concurrency counter — scoped to this createSubagentTool() invocation,
  // meaning one counter per chat request (since getMergedTools is called once per request).
  let activeCount = 0;

  // Resolve subagent model: frontend override → server env → main model
  const resolveSubagentModel = (): LanguageModel => {
    if (options?.subagentModel?.default) {
      return getLanguageModel(options.subagentModel.default);
    }
    if (process.env.SUBAGENT_MODEL) {
      return getLanguageModel(process.env.SUBAGENT_MODEL);
    }
    return mainModel;
  };
  return tool({
    description:
      "Delegate a task to an autonomous subagent that runs in its own context window. " +
      "The subagent can only use READ tools — it cannot perform write/mutation operations " +
      "or ask the user questions. Use this for parallel data gathering, research, or " +
      "analysis tasks. You can call multiple subagent tools in parallel for concurrent work. " +
      "If the task ultimately requires a write operation, instruct the subagent to return " +
      "the necessary parameters, then perform the write yourself using executePlan.",
    inputSchema: z.object({
      task: z
        .string()
        .describe(
          "Clear, self-contained description of the task for the subagent to complete.",
        ),
      systemPrompt: z
        .string()
        .describe(
          "System prompt for the subagent. Must specify: (1) what input/context the subagent has, " +
          "(2) what task to accomplish, (3) what output format to produce in its final response. " +
          "Remind the subagent that it can only read data and must write a clear summary as its " +
          "final response.",
        ),
    }),

    execute: async function* ({ task, systemPrompt }, { abortSignal }) {
      // ── Concurrency gate: reject if all parallel slots are in use ──────
      if (activeCount >= maxParallel) {
        logger.warn(
          `[Subagent] Rejected: ${activeCount}/${maxParallel} parallel slots in use`,
        );
        yield {
          id: "subagent-rejected",
          role: "assistant" as const,
          parts: [
            {
              type: "text" as const,
              text: `[Subagent rejected: all ${maxParallel} parallel slot(s) are in use. Retry this task in a subsequent step.]`,
            },
          ],
        };
        return;
      }

      activeCount++;
      try {
        const readOnlyTools = filterReadOnlyTools(allTools, toolSchemas, skillSchemas);

        const toolNames = Object.keys(readOnlyTools);
        logger.info(
          `[Subagent] Starting (${activeCount}/${maxParallel} slots) with ${toolNames.length} read-only tool(s): ${toolNames.join(", ") || "(none)"}`,
        );

        // Resolve the subagent model: frontend config → env override → main model
        const subagentModel = resolveSubagentModel();

        const subagent = new ToolLoopAgent({
          model: subagentModel,
          instructions: systemPrompt,
          tools: readOnlyTools,
          stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
        });

        // Create a timeout abort controller merged with the parent signal
        const timeoutController = new AbortController();
        const timer = setTimeout(
          () => timeoutController.abort("Subagent timeout"),
          effectiveTimeoutMs,
        );

        const signals: AbortSignal[] = [timeoutController.signal];
        if (abortSignal) signals.push(abortSignal);
        const mergedSignal = AbortSignal.any(signals);

        try {
          const result = await subagent.stream({
            prompt: task,
            abortSignal: mergedSignal,
          });

          // Stream incremental UIMessage updates as preliminary tool results.
          // Each `yield` replaces the previous output entirely on the frontend.
          for await (const message of readUIMessageStream({
            stream: result.toUIMessageStream(),
          })) {
            yield message;
          }

          logger.info("[Subagent] Completed successfully");
        } catch (err: unknown) {
          // If the parent request was aborted (user clicked stop), re-throw
          // so the main agent's stream terminates cleanly.
          if (abortSignal?.aborted) {
            logger.info("[Subagent] Aborted by parent signal");
            throw err;
          }

          // Timeout — log and let the last yielded partial result stand.
          // The generator ends, making the last yielded UIMessage the final output.
          if (timeoutController.signal.aborted) {
            logger.warn(
              `[Subagent] Timed out after ${effectiveTimeoutMs}ms`,
            );
            // Yield a final text-only message indicating timeout
            yield {
              id: "subagent-timeout",
              role: "assistant" as const,
              parts: [
                {
                  type: "text" as const,
                  text: `[Subagent timed out after ${Math.round(effectiveTimeoutMs / 1000)}s. Partial results may be available above.]`,
                },
              ],
            };
            return;
          }

          // Unexpected error
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`[Subagent] Error: ${msg}`);
          throw err;
        } finally {
          clearTimeout(timer);
        }
      } finally {
        activeCount--;
      }
    },

    // Control what the main agent's model sees.
    // The user sees the full streaming execution trace in the SubagentCard,
    // but the model only sees the subagent's final text summary — keeping
    // the main agent's context window clean.
    toModelOutput: ({ output: message }: { output: any }) => {
      if (!message || !message.parts || !Array.isArray(message.parts)) {
        return { type: "text" as const, value: "Subagent task completed with no output." };
      }

      // Find the last text part — this is the subagent's summary/conclusion
      const lastTextPart = [...message.parts]
        .reverse()
        .find((p: any) => p.type === "text" && typeof p.text === "string" && p.text.trim());

      return {
        type: "text" as const,
        value: lastTextPart?.text ?? "Subagent task completed with no text output.",
      };
    },
  });
}
