import { FUNCTION_TYPE, getErrorMessage, type FunctionDefinition } from "@ocean-mcp/shared";
import { functionRegistry } from "../registry";

/**
 * Execution engine — executes function definitions on the browser side.
 * Handles both "code" type (via new Function) and "executor" type (direct invocation).
 */
export async function executeFunction(
  functionId: string,
  args: Record<string, any>,
): Promise<any> {
  const fn = functionRegistry.get(functionId);

  if (!fn) {
    throw new Error(`Function not found: ${functionId}`);
  }

  if (fn.type === FUNCTION_TYPE.CODE) {
    return executeCodeFunction(fn.code, args);
  } else if (fn.type === FUNCTION_TYPE.EXECUTOR) {
    return fn.executor(args);
  }

  throw new Error(`Unknown function type for: ${functionId}`);
}

/**
 * Execute a code-string function via `new Function()`.
 * The code runs in the browser context with access to `window`, `document`,
 * `fetch`, and the `args` parameter.
 */
async function executeCodeFunction(
  code: string,
  args: Record<string, any>,
): Promise<any> {
  try {
    // Create an async function from the code string
    // The function receives `args` as a parameter and has access to browser globals
    const fn = new Function(
      "args",
      "window",
      "document",
      "fetch",
      `"use strict"; return (async () => { ${code} })()`,
    );

    return await fn(args, window, document, fetch.bind(window));
  } catch (error) {
    throw new Error(
      `Code execution failed: ${getErrorMessage(error)}`,
    );
  }
}
