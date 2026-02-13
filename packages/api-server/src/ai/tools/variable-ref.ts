/**
 * Pattern matching variable references with optional property paths:
 *   $0, $1, $0.id, $0.data.name, $0[0], $0.items[0].name
 *
 * Captures:
 *   Group 1: step index (digits)
 *   Group 2: property path (optional, e.g. ".id", ".data.name", "[0].name")
 */
const VARIABLE_REF_PATTERN = /\$(\d+)((?:\.[a-zA-Z_]\w*|\[\d+\])*)/;
const VARIABLE_REF_PATTERN_GLOBAL = /\$(\d+)((?:\.[a-zA-Z_]\w*|\[\d+\])*)/g;

/**
 * Resolve a property path (e.g. ".id", ".data.name", "[0].name") against a value.
 * Returns undefined if traversal fails at any point.
 */
function resolvePath(root: unknown, path: string): unknown {
  if (!path) return root;

  let current: any = root;
  // Tokenize: split ".foo" and "[0]" segments
  const segments = path.match(/\.[a-zA-Z_]\w*|\[\d+\]/g);
  if (!segments) return root;

  for (const segment of segments) {
    if (current == null) return undefined;
    if (segment.startsWith("[")) {
      // Array index: "[0]"
      const idx = Number(segment.slice(1, -1));
      current = current[idx];
    } else {
      // Dot property: ".foo"
      const key = segment.slice(1);
      current = current[key];
    }
  }

  return current;
}

/**
 * Check whether a value (string, object, or array) contains any $N variable
 * references that need to be resolved at execution time.
 */
export function containsVariableRef(value: unknown): boolean {
  if (typeof value === "string") {
    return VARIABLE_REF_PATTERN.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(containsVariableRef);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsVariableRef);
  }
  return false;
}

/**
 * Recursively resolve $N (and $N.path) variable references in a value using
 * results from previously executed steps.
 *
 * Supported reference forms:
 *   - "$0"           → full result of step 0 (type-preserving)
 *   - "$0.id"        → step 0 result's `id` property
 *   - "$0.data.name" → nested property access
 *   - "$0[0]"        → array index access
 *   - "$0[0].name"   → mixed access
 *
 * When the entire string is a single reference (exact match), the resolved
 * value preserves its original type (object, array, number, etc.).
 *
 * When references are embedded in a larger string, each is interpolated as a
 * string (objects/arrays are JSON-stringified).
 *
 * Throws if a referenced step index has no result or if the property path
 * resolves to undefined.
 */
export function resolveVariableRefs(
  value: unknown,
  stepResults: Map<number, any>,
): unknown {
  if (typeof value === "string") {
    // Exact match: the entire string is a single variable reference
    // e.g. "$0", "$0.id", "$0.data[0].name"
    const exactMatch = new RegExp(
      `^${VARIABLE_REF_PATTERN.source}$`,
    ).exec(value);
    if (exactMatch) {
      const idx = Number(exactMatch[1]);
      const path = exactMatch[2] || "";
      if (!stepResults.has(idx)) {
        throw new Error(
          `Variable reference $${idx} cannot be resolved: step ${idx} has no result.`,
        );
      }
      return resolvePath(stepResults.get(idx), path);
    }

    // Embedded references: "prefix-$0.id-$1-suffix"
    if (VARIABLE_REF_PATTERN.test(value)) {
      return value.replace(
        VARIABLE_REF_PATTERN_GLOBAL,
        (_match, idxStr, path) => {
          const idx = Number(idxStr);
          if (!stepResults.has(idx)) {
            throw new Error(
              `Variable reference $${idx} cannot be resolved: step ${idx} has no result.`,
            );
          }
          const result = resolvePath(stepResults.get(idx), path || "");
          // Primitives are stringified naturally; objects/arrays use JSON
          return typeof result === "object" && result !== null
            ? JSON.stringify(result)
            : String(result);
        },
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveVariableRefs(item, stepResults));
  }

  if (value !== null && typeof value === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      resolved[key] = resolveVariableRefs(val, stepResults);
    }
    return resolved;
  }

  // Primitives (number, boolean, null) pass through unchanged
  return value;
}
