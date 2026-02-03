import type { FlowNode, FunctionDefinition } from "../types";

type StatusCallback = (
  nodeId: string,
  status: FlowNode["status"],
  result?: unknown,
  error?: string
) => void;

/**
 * Execute a single function with the given arguments
 */
export async function executeFunction(
  func: FunctionDefinition,
  args: Record<string, unknown>
): Promise<unknown> {
  // Create a sandboxed function using new Function()
  // The function has access to 'args' and 'window'
  const executor = new Function(
    "args",
    "window",
    `"use strict";
    ${func.code}`
  );

  // Execute with a timeout to prevent infinite loops
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Function execution timed out (10s limit)"));
    }, 10000);

    try {
      const result = executor(args, window);
      
      // Handle both sync and async results
      if (result instanceof Promise) {
        result
          .then((r) => {
            clearTimeout(timeout);
            resolve(r);
          })
          .catch((e) => {
            clearTimeout(timeout);
            reject(e);
          });
      } else {
        clearTimeout(timeout);
        resolve(result);
      }
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

/**
 * Substitute $N.path references in arguments with previous results
 */
export function substituteReferences(
  args: Record<string, unknown>,
  previousResults: unknown[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.startsWith("$")) {
      const match = value.match(/^\$(\d+)(.*)$/);
      if (match) {
        const index = parseInt(match[1], 10);
        const path = match[2];
        let resolved = previousResults[index];

        if (path) {
          // Navigate the path (e.g., .clusters[0].id)
          const pathParts = path.match(/\.(\w+)|\[(\d+)\]/g) || [];
          for (const part of pathParts) {
            if (resolved == null) break;
            if (part.startsWith(".")) {
              resolved = (resolved as Record<string, unknown>)[part.slice(1)];
            } else if (part.startsWith("[")) {
              const idx = parseInt(part.slice(1, -1), 10);
              resolved = (resolved as unknown[])[idx];
            }
          }
        }

        result[key] = resolved;
      } else {
        result[key] = value;
      }
    } else if (Array.isArray(value)) {
      // Recursively substitute in array elements
      result[key] = value.map((item) => {
        if (typeof item === "string" && item.startsWith("$")) {
          // Handle string references in arrays
          return substituteReferences({ _: item }, previousResults)._;
        }
        if (Array.isArray(item)) {
          // Handle nested arrays
          return substituteReferences({ _: item }, previousResults)._;
        }
        if (typeof item === "object" && item !== null) {
          return substituteReferences(
            item as Record<string, unknown>,
            previousResults
          );
        }
        return item;
      });
    } else if (typeof value === "object" && value !== null) {
      // Recursively substitute in nested objects
      result[key] = substituteReferences(
        value as Record<string, unknown>,
        previousResults
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Execute a flow (array of nodes) sequentially
 * Calls statusCallback to update UI in real-time
 */
export async function executeFlow(
  nodes: FlowNode[],
  registry: FunctionDefinition[],
  statusCallback: StatusCallback
): Promise<FlowNode[]> {
  const updatedNodes: FlowNode[] = [...nodes];
  const previousResults: unknown[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    
    // Update status to running
    statusCallback(node.id, "running");
    updatedNodes[i] = { ...node, status: "running" };

    // Find the function in registry
    const func = registry.find((f) => f.id === node.functionId);
    if (!func) {
      const error = `Function not found: ${node.functionId}`;
      statusCallback(node.id, "failed", undefined, error);
      updatedNodes[i] = { ...node, status: "failed", error };
      previousResults.push(null);
      continue;
    }

    try {
      // Substitute references from previous results
      const resolvedArgs = substituteReferences(node.arguments, previousResults);
      
      // Execute the function
      const result = await executeFunction(func, resolvedArgs);
      
      // Update status to success
      statusCallback(node.id, "success", result);
      updatedNodes[i] = { ...node, status: "success", result };
      previousResults.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      statusCallback(node.id, "failed", undefined, errorMessage);
      updatedNodes[i] = { ...node, status: "failed", error: errorMessage };
      previousResults.push(null);
      
      // Stop execution on error
      break;
    }
  }

  return updatedNodes;
}

/**
 * Execute multiple read operations sequentially
 * Used for EXECUTE_READ handling
 */
export async function executeReads(
  reads: { id: string; functionId: string; arguments: Record<string, unknown> }[],
  registry: FunctionDefinition[]
): Promise<{ id: string; result: unknown; error?: string }[]> {
  const results: { id: string; result: unknown; error?: string }[] = [];
  const previousResults: unknown[] = [];

  for (const read of reads) {
    const func = registry.find((f) => f.id === read.functionId);
    
    if (!func) {
      results.push({
        id: read.id,
        result: null,
        error: `Function not found: ${read.functionId}`,
      });
      previousResults.push(null);
      continue;
    }

    if (func.type !== "read") {
      results.push({
        id: read.id,
        result: null,
        error: `Function ${read.functionId} is not a read function`,
      });
      previousResults.push(null);
      continue;
    }

    try {
      const resolvedArgs = substituteReferences(read.arguments, previousResults);
      const result = await executeFunction(func, resolvedArgs);
      results.push({ id: read.id, result });
      previousResults.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({ id: read.id, result: null, error: errorMessage });
      previousResults.push(null);
    }
  }

  return results;
}
