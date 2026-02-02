import type { FunctionDefinition } from "../types";
import { mockFunctions } from "./mockFunctions";

const STORAGE_KEY = "hacker-agent-functions";

/**
 * Initialize the registry with mock functions (always replaces localStorage)
 */
export function initRegistry(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mockFunctions));
}

/**
 * Get all functions from the registry
 */
export function getRegistry(): FunctionDefinition[] {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    initRegistry();
    return mockFunctions;
  }
  try {
    return JSON.parse(data) as FunctionDefinition[];
  } catch {
    return mockFunctions;
  }
}

/**
 * Get a single function by ID
 */
export function getFunction(id: string): FunctionDefinition | undefined {
  const functions = getRegistry();
  return functions.find((f) => f.id === id);
}

/**
 * Add a new function to the registry
 */
export function addFunction(func: FunctionDefinition): void {
  const functions = getRegistry();
  const existing = functions.findIndex((f) => f.id === func.id);
  
  if (existing >= 0) {
    functions[existing] = func;
  } else {
    functions.push(func);
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(functions));
}

/**
 * Update an existing function
 */
export function updateFunction(
  id: string,
  updates: Partial<FunctionDefinition>
): FunctionDefinition | null {
  const functions = getRegistry();
  const index = functions.findIndex((f) => f.id === id);
  
  if (index === -1) {
    return null;
  }
  
  functions[index] = { ...functions[index], ...updates };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(functions));
  
  return functions[index];
}

/**
 * Delete a function from the registry
 */
export function deleteFunction(id: string): boolean {
  const functions = getRegistry();
  const index = functions.findIndex((f) => f.id === id);
  
  if (index === -1) {
    return false;
  }
  
  functions.splice(index, 1);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(functions));
  
  return true;
}

/**
 * Reset registry to default mock functions
 */
export function resetRegistry(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mockFunctions));
}

/**
 * Get functions by type (read or write)
 */
export function getFunctionsByType(type: "read" | "write"): FunctionDefinition[] {
  return getRegistry().filter((f) => f.type === type);
}
