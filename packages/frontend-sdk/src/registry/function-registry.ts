import type { FunctionDefinition, FunctionSchema } from "oceanmcp-shared";

/**
 * Function Registry — stores all registered function definitions.
 * Supports both pre-registered (bundled) and dynamically registered tools.
 */
class FunctionRegistry {
  private functions = new Map<string, FunctionDefinition>();

  /** Register a function definition */
  register(fn: FunctionDefinition): void {
    this.functions.set(fn.id, fn);
  }

  /** Unregister a function by ID */
  unregister(id: string): boolean {
    return this.functions.delete(id);
  }

  /** Get a function definition by ID */
  get(id: string): FunctionDefinition | undefined {
    return this.functions.get(id);
  }

  /** Get all registered function definitions */
  getAll(): FunctionDefinition[] {
    return Array.from(this.functions.values());
  }

  /** Get serializable schemas (without executor functions) for sending to server */
  getAllSchemas(): FunctionSchema[] {
    return this.getAll().map((fn) => ({
      id: fn.id,
      name: fn.name,
      description: fn.description,
      type: fn.type,
      operationType: fn.operationType,
      ...(fn.autoApprove != null && { autoApprove: fn.autoApprove }),
      parameters: fn.parameters,
    }));
  }

  /** Get function count */
  get size(): number {
    return this.functions.size;
  }
}

export const functionRegistry = new FunctionRegistry();
