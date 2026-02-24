/**
 * Pattern matching variable references with optional property paths:
 *   $0, $1, $0.id, $0.data.name, $0[0], $0.items[0].name,
 *   $0.find(name=="test"), $0.find(name=="test").id,
 *   $0.items.find(status=="active").config.region
 *
 * Captures:
 *   Group 1: step index (digits)
 *   Group 2: property path (optional, e.g. ".id", ".data.name", "[0].name", ".find(...).id")
 *
 * Path segments:
 *   - .identifier     — dot property access
 *   - [digits]        — array index access
 *   - .find(pred)     — array query: find first element matching predicate
 */
const PATH_SEGMENT =
  /(?:\.find\([^)]+\)|\.[a-zA-Z_]\w*|\[\d+\])/;
const VARIABLE_REF_PATTERN = new RegExp(
  `\\$(\\d+)(${PATH_SEGMENT.source}*)`,
);
const VARIABLE_REF_PATTERN_GLOBAL = new RegExp(
  `\\$(\\d+)(${PATH_SEGMENT.source}*)`,
  "g",
);

/**
 * Parse a find() predicate string like `name=="test"` or `count==3` into its
 * constituent parts: field name, operator, and comparison value.
 *
 * Supported operators: == (equals), != (not equals)
 * Supported value literals:
 *   - Quoted strings: "hello", "my-cluster"
 *   - Numbers: 3, 42.5, -1
 *   - Booleans: true, false
 *   - Null: null
 */
function parseFindPredicate(predicate: string): {
  field: string;
  operator: "==" | "!=";
  value: string | number | boolean | null;
} {
  // Match: <identifier> <operator> <value>
  const match = predicate.match(
    /^([a-zA-Z_]\w*)\s*(==|!=)\s*(.+)$/,
  );
  if (!match) {
    throw new Error(
      `Invalid find() predicate: "${predicate}". Expected format: field==value or field!=value`,
    );
  }

  const field = match[1];
  const operator = match[2] as "==" | "!=";
  const rawValue = match[3].trim();

  let value: string | number | boolean | null;

  // Quoted string: "..."
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    value = rawValue.slice(1, -1);
  }
  // Boolean
  else if (rawValue === "true") {
    value = true;
  } else if (rawValue === "false") {
    value = false;
  }
  // Null
  else if (rawValue === "null") {
    value = null;
  }
  // Number
  else if (!Number.isNaN(Number(rawValue))) {
    value = Number(rawValue);
  }
  // Fallback: treat as unquoted string
  else {
    value = rawValue;
  }

  return { field, operator, value };
}

/**
 * Check whether a single item matches a find() predicate.
 */
function matchesPredicate(
  item: any,
  predicate: { field: string; operator: "==" | "!="; value: string | number | boolean | null },
): boolean {
  if (item == null || typeof item !== "object") return false;
  const actual = item[predicate.field];
  if (predicate.operator === "==") {
    return actual === predicate.value;
  }
  // !=
  return actual !== predicate.value;
}

/**
 * Resolve a property path (e.g. ".id", ".data.name", "[0].name",
 * ".find(name==\"test\").id") against a value.
 * Returns undefined if traversal fails at any point.
 */
function resolvePath(root: unknown, path: string): unknown {
  if (!path) return root;

  let current: any = root;
  // Tokenize: split ".foo", "[0]", and ".find(...)" segments
  const segments = path.match(
    /\.find\([^)]+\)|\.[a-zA-Z_]\w*|\[\d+\]/g,
  );
  if (!segments) return root;

  for (const segment of segments) {
    if (current == null) return undefined;

    if (segment.startsWith(".find(")) {
      // Extract predicate from ".find(<predicate>)"
      const predicateStr = segment.slice(6, -1); // strip ".find(" and ")"
      if (!Array.isArray(current)) return undefined;
      const predicate = parseFindPredicate(predicateStr);
      current = current.find((item: any) => matchesPredicate(item, predicate));
    } else if (segment.startsWith("[")) {
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
 *   - "$0.find(name==\"test\")"        → find first element in array where name == "test"
 *   - "$0.find(name==\"test\").id"     → find + property access
 *   - "$0.items.find(status==\"active\").config" → nested array find + deep access
 *
 * Find predicate operators: == (equals), != (not equals)
 * Find predicate value literals: "string", number, true, false, null
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
