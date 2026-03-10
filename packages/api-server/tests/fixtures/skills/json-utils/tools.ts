export default {
  jsonQuery: {
    id: "jsonQuery",
    name: "JSON Query",
    description:
      "Extract a value from a JSON object using a dot-notation path. " +
      'Supports array indexing with [N]. Example path: "data.users[0].name".',
    type: "code",
    operationType: "read",
    code: `
      const { json, path } = args;
      let obj;
      try {
        obj = typeof json === "string" ? JSON.parse(json) : json;
      } catch (e) {
        return { error: "Invalid JSON: " + e.message };
      }

      const segments = path.replace(/\\[(\\d+)\\]/g, ".$1").split(".");
      let current = obj;
      for (const seg of segments) {
        if (current == null) {
          return { path, value: undefined, found: false };
        }
        current = current[seg];
      }
      return { path, value: current, found: current !== undefined, type: typeof current };
    `,
    parameters: [
      {
        name: "json",
        type: "object",
        description: "The JSON object (or JSON string) to query",
        required: true,
      },
      {
        name: "path",
        type: "string",
        description:
          'Dot-notation path to extract, e.g. "data.users[0].name"',
        required: true,
      },
    ],
  },

  jsonTransform: {
    id: "jsonTransform",
    name: "JSON Transform",
    description:
      "Transform a JSON object by picking specific keys, " +
      "omitting keys, or flattening nested structures.",
    type: "code",
    operationType: "read",
    code: `
      const { json, operation, keys } = args;
      let obj;
      try {
        obj = typeof json === "string" ? JSON.parse(json) : json;
      } catch (e) {
        return { error: "Invalid JSON: " + e.message };
      }

      if (operation === "pick") {
        const result = {};
        for (const key of (keys || [])) {
          if (key in obj) result[key] = obj[key];
        }
        return { operation: "pick", keys, result };
      }

      if (operation === "omit") {
        const omitSet = new Set(keys || []);
        const result = {};
        for (const [k, v] of Object.entries(obj)) {
          if (!omitSet.has(k)) result[k] = v;
        }
        return { operation: "omit", keys, result };
      }

      if (operation === "flatten") {
        const result = {};
        function walk(o, prefix) {
          for (const [k, v] of Object.entries(o)) {
            const newKey = prefix ? prefix + "." + k : k;
            if (v && typeof v === "object" && !Array.isArray(v)) {
              walk(v, newKey);
            } else {
              result[newKey] = v;
            }
          }
        }
        walk(obj, "");
        return { operation: "flatten", result };
      }

      return { error: "Unknown operation: " + operation };
    `,
    parameters: [
      {
        name: "json",
        type: "object",
        description: "The JSON object to transform",
        required: true,
      },
      {
        name: "operation",
        type: "string",
        description: "Transform operation to apply",
        required: true,
        enumMap: {
          pick: "Keep only specified keys",
          omit: "Remove specified keys",
          flatten: "Flatten nested object to dot-notation keys",
        },
      },
      {
        name: "keys",
        type: "string_array",
        description:
          "Keys to pick or omit (required for pick/omit, ignored for flatten)",
        required: false,
      },
    ],
  },
};
