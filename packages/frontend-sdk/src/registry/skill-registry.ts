import type {
  FunctionDefinition,
  FunctionSchema,
  SkillSchema,
} from "@ocean-mcp/shared";

// ─── Frontend-Local Skill Definition ─────────────────────────────────────────

/**
 * A skill definition as registered by the host application.
 *
 * This is the frontend-local representation that may contain non-serializable
 * parts (e.g. executor functions in tools). When sent to the server over
 * WebSocket, it is converted to a `SkillSchema` via `getAllSchemas()`.
 */
export interface SkillDefinition {
  /** Unique skill identifier (used by loadSkill) */
  name: string;
  /** Localized Chinese display name; shown when locale is zh-CN */
  cnName?: string;
  /** When to use this skill (shown in system prompt catalog) */
  description: string;
  /** Full markdown instructions (returned by loadSkill on-demand) */
  instructions: string;
  /** Tool definitions bundled with this skill */
  tools?: FunctionDefinition[];
}

// ─── Skill Registry ──────────────────────────────────────────────────────────

/**
 * Skill Registry — stores all registered skill definitions.
 * Supports dynamic registration from the host application.
 *
 * Mirrors the FunctionRegistry pattern for tools but at the skill level.
 * Each skill bundles metadata, instructions, and optional tool definitions.
 */
class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();

  /** Register a skill definition */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill);
  }

  /** Unregister a skill by name */
  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  /** Get a skill definition by name */
  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /** Get all registered skill definitions */
  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get serializable schemas for sending to the server via WebSocket.
   *
   * Strips non-serializable parts from tool definitions (executor functions,
   * code strings, showRender callbacks) — the server only needs the schema
   * metadata. Actual execution happens browser-side via the WS proxy.
   */
  getAllSchemas(): SkillSchema[] {
    return this.getAll().map((skill) => ({
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      tools: skill.tools?.map(
        (fn): FunctionSchema => ({
          id: fn.id,
          name: fn.name,
          description: fn.description,
          type: fn.type,
          operationType: fn.operationType,
          parameters: fn.parameters.map((p) => {
            if (!p.columns) return p;
            const stripped = { ...p, columns: {} as typeof p.columns };
            for (const [key, cfg] of Object.entries(p.columns)) {
              stripped.columns![key] = { label: cfg.label };
            }
            return stripped;
          }),
        }),
      ),
    }));
  }

  /** Get skill count */
  get size(): number {
    return this.skills.size;
  }
}

export const skillRegistry = new SkillRegistry();
