/**
 * Code tool adapter — wraps `CodeFunctionDefinition` objects into Vercel AI
 * SDK `Tool` instances that can execute server-side via `new Function()`.
 *
 * ## Background
 *
 * Skills bundled in `.zip` files may export tools in their `tools.ts` file
 * using two formats:
 *
 *   1. **Vercel AI SDK `Tool`** — created via `tool({ description, inputSchema, execute })`.
 *      These already have a server-side `execute` function and are used as-is.
 *
 *   2. **`CodeFunctionDefinition`** — the ocean-mcp format used extensively in
 *      the frontend SDK. These contain a `code` string that is executed via
 *      `new Function()`. Originally designed for browser-side execution (with
 *      access to `window`, `document`, `fetch`), they can also run server-side
 *      with appropriate mocks.
 *
 * This adapter auto-detects `CodeFunctionDefinition` entries in a mixed
 * export map and wraps them into proper `Tool` instances, making them
 * transparent to the rest of the skills pipeline.
 *
 * ## Server-Side Execution Environment
 *
 * When a `CodeFunctionDefinition`'s code runs on the server:
 *
 *   - **`args`**: the tool call arguments (same as browser-side)
 *   - **`fetch`**: a custom fetch function (currently stubs to global `fetch`;
 *     internal logic to be filled later for auth/proxy support)
 *   - **`window`**: a Proxy mock that returns `undefined` for property access
 *     and logs a warning. Prevents runtime crashes for code originally written
 *     for the browser.
 *   - **`document`**: same Proxy mock pattern as `window`
 *
 * ## Security Note
 *
 * The `new Function()` execution shares the same trust model as the browser
 * SDK: zip skills are explicitly registered by the deployer via CDN URL, so
 * the code is trusted at the same level as any server-side skill.
 */

import { tool, type Tool } from "ai";
import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  type CodeFunctionDefinition,
  type ParameterDefinition,
} from "@ocean-mcp/shared";
import { createZodSchema } from "../tools/index";

// ─── Type Detection ──────────────────────────────────────────────────────────

/**
 * Duck-type check for `CodeFunctionDefinition`.
 *
 * We can't use `instanceof` because the definition comes from a dynamic
 * `import()` of user-provided code. Instead we check the structural shape:
 *   - `type === "code"`
 *   - `code` is a non-empty string
 *   - `id` and `description` are strings
 *   - `parameters` is an array
 *
 * Vercel AI SDK `Tool` objects have a very different shape (they have
 * `inputSchema` and optionally `execute`), so there's no ambiguity.
 */
export function isCodeFunctionDefinition(
  obj: unknown,
): obj is CodeFunctionDefinition {
  if (!obj || typeof obj !== "object") return false;

  const candidate = obj as Record<string, unknown>;

  return (
    candidate.type === FUNCTION_TYPE.CODE &&
    typeof candidate.code === "string" &&
    candidate.code.length > 0 &&
    typeof candidate.id === "string" &&
    typeof candidate.description === "string" &&
    Array.isArray(candidate.parameters)
  );
}

// ─── Mocked Browser Globals ──────────────────────────────────────────────────

/**
 * Create a Proxy that mimics a browser global (`window` or `document`).
 *
 * Property access returns `undefined` (preventing crashes) and logs a
 * warning so developers know the code is using unsupported browser APIs.
 *
 * Method calls (e.g. `window.location.href`) are handled by returning
 * nested Proxies for object-like access patterns.
 */
function createBrowserGlobalMock(name: string): Record<string, any> {
  const warned = new Set<string>();

  const handler: ProxyHandler<Record<string, any>> = {
    get(_target, prop) {
      // Allow internal inspection without warnings
      if (typeof prop === "symbol") return undefined;
      if (prop === "toJSON") return () => `[Mock ${name}]`;
      if (prop === "toString") return () => `[Mock ${name}]`;
      if (prop === "valueOf") return () => undefined;

      const key = `${name}.${String(prop)}`;
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(
          `[CodeTool] Code accessed ${key} which is not available server-side`,
        );
      }

      return undefined;
    },
  };

  return new Proxy({}, handler);
}

// ─── Custom Fetch ────────────────────────────────────────────────────────────

/**
 * Server-side fetch function provided to code tools.
 *
 * Currently wraps the global `fetch` as a stub. Internal logic (e.g. auth
 * headers, proxy routing, cookie forwarding) should be filled in later.
 *
 * TODO: Implement custom fetch with internal auth/proxy logic.
 */
function createServerFetch(): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    return globalThis.fetch(input, init);
  };
}

// ─── Code Execution ──────────────────────────────────────────────────────────

/**
 * Execute a code-string function via `new Function()` on the server.
 *
 * Mirrors the browser-side `executeCodeFunction` from
 * `frontend-sdk/src/runtime/executor.ts` but provides server-appropriate
 * globals instead of real browser objects.
 *
 * @param code - The code string from the `CodeFunctionDefinition`
 * @param args - The tool call arguments
 * @returns The result of executing the code
 */
async function executeCodeFunction(
  code: string,
  args: Record<string, any>,
): Promise<any> {
  const serverFetch = createServerFetch();
  const windowMock = createBrowserGlobalMock("window");
  const documentMock = createBrowserGlobalMock("document");

  try {
    // Create an async function from the code string.
    // Same signature as browser-side: (args, window, document, fetch)
    const fn = new Function(
      "args",
      "window",
      "document",
      "fetch",
      `"use strict"; return (async () => { ${code} })()`,
    );

    return await fn(args, windowMock, documentMock, serverFetch);
  } catch (error) {
    throw new Error(
      `Code tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ─── Single Definition Wrapping ──────────────────────────────────────────────

/**
 * Wrap a single `CodeFunctionDefinition` into a Vercel AI SDK `Tool`.
 *
 * The resulting tool:
 *   - Has a Zod `inputSchema` derived from `def.parameters`
 *   - Executes the `def.code` string via `new Function()` server-side
 *   - Sets `needsApproval: true` for write operations without `autoApprove`
 *
 * @param def - The `CodeFunctionDefinition` to wrap
 * @returns A Vercel AI SDK `Tool` instance
 */
export function wrapCodeFunctionAsTool(
  def: CodeFunctionDefinition,
): Tool<any, any> {
  const inputSchema = createZodSchema(def.parameters);

  const requiresApproval =
    def.operationType === OPERATION_TYPE.WRITE && !def.autoApprove;

  return tool({
    description: def.description,
    inputSchema,
    ...(requiresApproval && { needsApproval: true }),
    execute: async (args) => {
      return executeCodeFunction(def.code, args);
    },
  });
}

// ─── Batch Wrapping (Mixed Exports) ──────────────────────────────────────────

/**
 * Process a mixed export map from a skill's `tools.ts` file.
 *
 * For each entry in the map:
 *   - If it's a `CodeFunctionDefinition` → wrap it into a `Tool` via
 *     `wrapCodeFunctionAsTool()`, keyed by `def.id`
 *   - Otherwise (assumed to be a Vercel AI SDK `Tool`) → pass through as-is
 *
 * This allows `tools.ts` to freely mix both tool formats:
 *
 * ```ts
 * // tools.ts — mixed export example
 * import { tool } from "ai";
 * import { FUNCTION_TYPE, OPERATION_TYPE } from "@ocean-mcp/shared";
 *
 * export default {
 *   // Vercel AI SDK tool (passed through)
 *   myServerTool: tool({ description: "...", inputSchema: ..., execute: ... }),
 *
 *   // CodeFunctionDefinition (auto-wrapped)
 *   fetchData: {
 *     id: "fetchData",
 *     type: "code",
 *     name: "Fetch Data",
 *     description: "Fetches data from an API",
 *     operationType: "read",
 *     code: `return fetch("https://api.example.com/data").then(r => r.json())`,
 *     parameters: [],
 *   },
 * };
 * ```
 *
 * @param exports - The raw exports object from `tools.ts`
 * @returns A normalized `Record<string, Tool>` ready for merging
 */
export function wrapCodeFunctionDefinitions(
  exports: Record<string, any>,
): Record<string, Tool<any, any>> {
  const result: Record<string, Tool<any, any>> = {};

  for (const [key, value] of Object.entries(exports)) {
    if (isCodeFunctionDefinition(value)) {
      // CodeFunctionDefinition → wrap and key by def.id
      result[value.id] = wrapCodeFunctionAsTool(value);
    } else if (value && typeof value === "object") {
      // Assume it's a Vercel AI SDK Tool — pass through with original key
      result[key] = value as Tool<any, any>;
    }
  }

  return result;
}
