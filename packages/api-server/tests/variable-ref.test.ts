import { describe, test, expect } from "bun:test";
import { containsVariableRef, resolveVariableRefs } from "../src/ai/tools/variable-ref";

// ---------------------------------------------------------------------------
// containsVariableRef
// ---------------------------------------------------------------------------
describe("containsVariableRef", () => {
  describe("string values", () => {
    test("detects exact variable reference $0", () => {
      expect(containsVariableRef("$0")).toBe(true);
    });

    test("detects exact variable reference $1", () => {
      expect(containsVariableRef("$1")).toBe(true);
    });

    test("detects multi-digit variable reference $12", () => {
      expect(containsVariableRef("$12")).toBe(true);
    });

    test("detects embedded variable reference in prefix", () => {
      expect(containsVariableRef("cluster-$0")).toBe(true);
    });

    test("detects embedded variable reference in suffix", () => {
      expect(containsVariableRef("$0-backup")).toBe(true);
    });

    test("detects embedded variable reference in middle", () => {
      expect(containsVariableRef("prefix-$0-suffix")).toBe(true);
    });

    test("detects multiple variable references", () => {
      expect(containsVariableRef("$0-$1")).toBe(true);
    });

    test("returns false for plain string", () => {
      expect(containsVariableRef("hello")).toBe(false);
    });

    test("returns false for empty string", () => {
      expect(containsVariableRef("")).toBe(false);
    });

    test("returns false for string with only dollar sign", () => {
      expect(containsVariableRef("$")).toBe(false);
    });

    test("returns false for string with dollar and non-digit", () => {
      expect(containsVariableRef("$abc")).toBe(false);
    });

    test("detects variable reference with dot path $0.id", () => {
      expect(containsVariableRef("$0.id")).toBe(true);
    });

    test("detects variable reference with nested dot path $0.data.name", () => {
      expect(containsVariableRef("$0.data.name")).toBe(true);
    });

    test("detects variable reference with bracket notation $0[0]", () => {
      expect(containsVariableRef("$0[0]")).toBe(true);
    });

    test("detects variable reference with mixed path $0[0].name", () => {
      expect(containsVariableRef("$0[0].name")).toBe(true);
    });

    test("detects embedded variable reference with dot path", () => {
      expect(containsVariableRef("id=$0.id")).toBe(true);
    });
  });

  describe("object values", () => {
    test("detects variable ref in object value", () => {
      expect(containsVariableRef({ clusterId: "$0" })).toBe(true);
    });

    test("detects variable ref in nested object value", () => {
      expect(containsVariableRef({ config: { id: "$0" } })).toBe(true);
    });

    test("returns false for object with no refs", () => {
      expect(containsVariableRef({ name: "test", count: 5 })).toBe(false);
    });

    test("returns false for empty object", () => {
      expect(containsVariableRef({})).toBe(false);
    });
  });

  describe("array values", () => {
    test("detects variable ref in array element", () => {
      expect(containsVariableRef(["$0", "hello"])).toBe(true);
    });

    test("detects variable ref in nested array", () => {
      expect(containsVariableRef([["$0"]])).toBe(true);
    });

    test("returns false for array with no refs", () => {
      expect(containsVariableRef(["hello", 42])).toBe(false);
    });

    test("returns false for empty array", () => {
      expect(containsVariableRef([])).toBe(false);
    });
  });

  describe("primitive values", () => {
    test("returns false for number", () => {
      expect(containsVariableRef(42)).toBe(false);
    });

    test("returns false for boolean", () => {
      expect(containsVariableRef(true)).toBe(false);
    });

    test("returns false for null", () => {
      expect(containsVariableRef(null)).toBe(false);
    });

    test("returns false for undefined", () => {
      expect(containsVariableRef(undefined)).toBe(false);
    });
  });

  describe("mixed nested structures", () => {
    test("detects ref deeply nested in object with arrays", () => {
      expect(
        containsVariableRef({
          steps: [{ args: { id: "$0" } }],
        }),
      ).toBe(true);
    });

    test("returns false for deep structure with no refs", () => {
      expect(
        containsVariableRef({
          steps: [{ args: { id: "static-id" } }],
        }),
      ).toBe(false);
    });
  });

  describe("repeated calls (regex statefulness check)", () => {
    test("returns consistent results across multiple calls", () => {
      // Ensures no global regex lastIndex issue
      expect(containsVariableRef("$0")).toBe(true);
      expect(containsVariableRef("$0")).toBe(true);
      expect(containsVariableRef("hello")).toBe(false);
      expect(containsVariableRef("$1")).toBe(true);
      expect(containsVariableRef("hello")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// resolveVariableRefs
// ---------------------------------------------------------------------------
describe("resolveVariableRefs", () => {
  describe("exact variable reference (type-preserving)", () => {
    test("resolves $0 to string result", () => {
      const results = new Map<number, any>([[0, "cluster-abc"]]);
      expect(resolveVariableRefs("$0", results)).toBe("cluster-abc");
    });

    test("resolves $0 to number result", () => {
      const results = new Map<number, any>([[0, 42]]);
      expect(resolveVariableRefs("$0", results)).toBe(42);
    });

    test("resolves $0 to boolean result", () => {
      const results = new Map<number, any>([[0, true]]);
      expect(resolveVariableRefs("$0", results)).toBe(true);
    });

    test("resolves $0 to null result", () => {
      const results = new Map<number, any>([[0, null]]);
      expect(resolveVariableRefs("$0", results)).toBe(null);
    });

    test("resolves $0 to object result (preserves type)", () => {
      const obj = { id: "abc", name: "test" };
      const results = new Map<number, any>([[0, obj]]);
      expect(resolveVariableRefs("$0", results)).toEqual(obj);
    });

    test("resolves $0 to array result (preserves type)", () => {
      const arr = [1, 2, 3];
      const results = new Map<number, any>([[0, arr]]);
      expect(resolveVariableRefs("$0", results)).toEqual(arr);
    });

    test("resolves $1 referencing second step", () => {
      const results = new Map<number, any>([
        [0, "first"],
        [1, "second"],
      ]);
      expect(resolveVariableRefs("$1", results)).toBe("second");
    });

    test("resolves multi-digit reference $12", () => {
      const results = new Map<number, any>([[12, "twelfth"]]);
      expect(resolveVariableRefs("$12", results)).toBe("twelfth");
    });
  });

  describe("embedded variable references (string interpolation)", () => {
    test("resolves embedded $0 with string result", () => {
      const results = new Map<number, any>([[0, "abc"]]);
      expect(resolveVariableRefs("cluster-$0-backup", results)).toBe(
        "cluster-abc-backup",
      );
    });

    test("resolves embedded $0 with number result", () => {
      const results = new Map<number, any>([[0, 42]]);
      expect(resolveVariableRefs("item-$0", results)).toBe("item-42");
    });

    test("resolves multiple embedded references", () => {
      const results = new Map<number, any>([
        [0, "cluster-1"],
        [1, "node-a"],
      ]);
      expect(resolveVariableRefs("$0/$1", results)).toBe("cluster-1/node-a");
    });

    test("resolves embedded reference with object result (JSON stringified)", () => {
      const results = new Map<number, any>([[0, { id: "abc" }]]);
      expect(resolveVariableRefs("result=$0", results)).toBe(
        'result={"id":"abc"}',
      );
    });

    test("resolves embedded reference with array result (JSON stringified)", () => {
      const results = new Map<number, any>([[0, [1, 2, 3]]]);
      expect(resolveVariableRefs("ids=$0", results)).toBe("ids=[1,2,3]");
    });

    test("resolves embedded reference with boolean result", () => {
      const results = new Map<number, any>([[0, true]]);
      expect(resolveVariableRefs("enabled=$0", results)).toBe("enabled=true");
    });
  });

  describe("non-variable strings pass through", () => {
    test("plain string unchanged", () => {
      const results = new Map<number, any>();
      expect(resolveVariableRefs("hello", results)).toBe("hello");
    });

    test("empty string unchanged", () => {
      const results = new Map<number, any>();
      expect(resolveVariableRefs("", results)).toBe("");
    });

    test("dollar sign without digit unchanged", () => {
      const results = new Map<number, any>();
      expect(resolveVariableRefs("$abc", results)).toBe("$abc");
    });
  });

  describe("object traversal", () => {
    test("resolves variable refs in object values", () => {
      const results = new Map<number, any>([[0, "abc-123"]]);
      const input = { clusterId: "$0", name: "my-cluster" };
      expect(resolveVariableRefs(input, results)).toEqual({
        clusterId: "abc-123",
        name: "my-cluster",
      });
    });

    test("resolves variable refs in nested objects", () => {
      const results = new Map<number, any>([
        [0, "cluster-1"],
        [1, "zone-a"],
      ]);
      const input = {
        config: {
          clusterId: "$0",
          zone: "$1",
          static: "value",
        },
      };
      expect(resolveVariableRefs(input, results)).toEqual({
        config: {
          clusterId: "cluster-1",
          zone: "zone-a",
          static: "value",
        },
      });
    });

    test("handles empty object", () => {
      const results = new Map<number, any>();
      expect(resolveVariableRefs({}, results)).toEqual({});
    });
  });

  describe("array traversal", () => {
    test("resolves variable refs in array elements", () => {
      const results = new Map<number, any>([
        [0, "id-1"],
        [1, "id-2"],
      ]);
      expect(resolveVariableRefs(["$0", "$1", "static"], results)).toEqual([
        "id-1",
        "id-2",
        "static",
      ]);
    });

    test("resolves variable refs in nested arrays", () => {
      const results = new Map<number, any>([[0, "val"]]);
      expect(resolveVariableRefs([["$0"]], results)).toEqual([["val"]]);
    });

    test("handles empty array", () => {
      const results = new Map<number, any>();
      expect(resolveVariableRefs([], results)).toEqual([]);
    });
  });

  describe("primitive passthrough", () => {
    test("number passes through unchanged", () => {
      const results = new Map<number, any>();
      expect(resolveVariableRefs(42, results)).toBe(42);
    });

    test("boolean passes through unchanged", () => {
      const results = new Map<number, any>();
      expect(resolveVariableRefs(true, results)).toBe(true);
    });

    test("null passes through unchanged", () => {
      const results = new Map<number, any>();
      expect(resolveVariableRefs(null, results)).toBe(null);
    });

    test("undefined passes through unchanged", () => {
      const results = new Map<number, any>();
      expect(resolveVariableRefs(undefined, results)).toBe(undefined);
    });
  });

  describe("complex mixed structures", () => {
    test("resolves a realistic plan step arguments object", () => {
      const results = new Map<number, any>([
        [0, { clusterId: "cls-123", name: "prod-cluster" }],
        [1, "node-456"],
      ]);
      const input = {
        cluster: "$0",
        nodeId: "$1",
        label: "node-$1-in-cluster",
        tags: ["production", "$1"],
        config: {
          replicas: 3,
          target: "$0",
        },
      };
      expect(resolveVariableRefs(input, results)).toEqual({
        cluster: { clusterId: "cls-123", name: "prod-cluster" },
        nodeId: "node-456",
        label: "node-node-456-in-cluster",
        tags: ["production", "node-456"],
        config: {
          replicas: 3,
          target: { clusterId: "cls-123", name: "prod-cluster" },
        },
      });
    });

    test("multi-step chain: step 2 references step 0 and step 1", () => {
      const results = new Map<number, any>([
        [0, "project-abc"],
        [1, "env-prod"],
      ]);
      const input = { projectId: "$0", envId: "$1", display: "$0/$1" };
      expect(resolveVariableRefs(input, results)).toEqual({
        projectId: "project-abc",
        envId: "env-prod",
        display: "project-abc/env-prod",
      });
    });
  });

  describe("error handling", () => {
    test("throws when exact ref references non-existent step", () => {
      const results = new Map<number, any>();
      expect(() => resolveVariableRefs("$0", results)).toThrow(
        "Variable reference $0 cannot be resolved: step 0 has no result.",
      );
    });

    test("throws when embedded ref references non-existent step", () => {
      const results = new Map<number, any>([[0, "exists"]]);
      expect(() => resolveVariableRefs("prefix-$5-suffix", results)).toThrow(
        "Variable reference $5 cannot be resolved: step 5 has no result.",
      );
    });

    test("throws when ref in object value references non-existent step", () => {
      const results = new Map<number, any>();
      expect(() =>
        resolveVariableRefs({ id: "$3" }, results),
      ).toThrow("Variable reference $3 cannot be resolved: step 3 has no result.");
    });

    test("throws when ref in array element references non-existent step", () => {
      const results = new Map<number, any>();
      expect(() => resolveVariableRefs(["$2"], results)).toThrow(
        "Variable reference $2 cannot be resolved: step 2 has no result.",
      );
    });

    test("throws for forward reference (step not yet executed)", () => {
      // Only step 0 has been executed; step 1 references step 2
      const results = new Map<number, any>([[0, "done"]]);
      expect(() => resolveVariableRefs("$2", results)).toThrow(
        "Variable reference $2 cannot be resolved: step 2 has no result.",
      );
    });
  });

  describe("edge cases", () => {
    test("resolves $0 when result is an empty string", () => {
      const results = new Map<number, any>([[0, ""]]);
      expect(resolveVariableRefs("$0", results)).toBe("");
    });

    test("resolves $0 when result is 0", () => {
      const results = new Map<number, any>([[0, 0]]);
      expect(resolveVariableRefs("$0", results)).toBe(0);
    });

    test("resolves $0 when result is false", () => {
      const results = new Map<number, any>([[0, false]]);
      expect(resolveVariableRefs("$0", results)).toBe(false);
    });

    test("resolves $0 when result is empty object", () => {
      const results = new Map<number, any>([[0, {}]]);
      expect(resolveVariableRefs("$0", results)).toEqual({});
    });

    test("resolves $0 when result is empty array", () => {
      const results = new Map<number, any>([[0, []]]);
      expect(resolveVariableRefs("$0", results)).toEqual([]);
    });

    test("embedded ref with result 0 stringifies correctly", () => {
      const results = new Map<number, any>([[0, 0]]);
      expect(resolveVariableRefs("count=$0", results)).toBe("count=0");
    });

    test("embedded ref with result false stringifies correctly", () => {
      const results = new Map<number, any>([[0, false]]);
      expect(resolveVariableRefs("enabled=$0", results)).toBe("enabled=false");
    });

    test("does not confuse dollar amounts with variable refs", () => {
      // "$" followed by non-digit should not be treated as a ref
      const results = new Map<number, any>();
      expect(resolveVariableRefs("$USD", results)).toBe("$USD");
    });

    test("handles consecutive refs $0$1 correctly", () => {
      const results = new Map<number, any>([
        [0, "A"],
        [1, "B"],
      ]);
      expect(resolveVariableRefs("$0$1", results)).toBe("AB");
    });
  });

  // -------------------------------------------------------------------------
  // Property path access ($0.id, $0.data.name, $0[0], etc.)
  // -------------------------------------------------------------------------
  describe("property path access (exact match, type-preserving)", () => {
    test("resolves $0.id from object result", () => {
      const results = new Map<number, any>([[0, { id: "abc-123", name: "test" }]]);
      expect(resolveVariableRefs("$0.id", results)).toBe("abc-123");
    });

    test("resolves $0.name from object result", () => {
      const results = new Map<number, any>([[0, { id: "abc", name: "my-cluster" }]]);
      expect(resolveVariableRefs("$0.name", results)).toBe("my-cluster");
    });

    test("resolves nested path $0.data.name", () => {
      const results = new Map<number, any>([
        [0, { data: { name: "deep-value", count: 5 } }],
      ]);
      expect(resolveVariableRefs("$0.data.name", results)).toBe("deep-value");
    });

    test("resolves nested path $0.data.count preserving number type", () => {
      const results = new Map<number, any>([
        [0, { data: { count: 42 } }],
      ]);
      expect(resolveVariableRefs("$0.data.count", results)).toBe(42);
    });

    test("resolves array index $0[0]", () => {
      const results = new Map<number, any>([[0, ["first", "second", "third"]]]);
      expect(resolveVariableRefs("$0[0]", results)).toBe("first");
    });

    test("resolves array index $0[2]", () => {
      const results = new Map<number, any>([[0, ["a", "b", "c"]]]);
      expect(resolveVariableRefs("$0[2]", results)).toBe("c");
    });

    test("resolves mixed path $0[0].name", () => {
      const results = new Map<number, any>([
        [0, [{ name: "first-item" }, { name: "second-item" }]],
      ]);
      expect(resolveVariableRefs("$0[0].name", results)).toBe("first-item");
    });

    test("resolves mixed path $0.items[1].id", () => {
      const results = new Map<number, any>([
        [0, { items: [{ id: "a" }, { id: "b" }, { id: "c" }] }],
      ]);
      expect(resolveVariableRefs("$0.items[1].id", results)).toBe("b");
    });

    test("resolves deep mixed path $0.data.list[0].nested.value", () => {
      const results = new Map<number, any>([
        [0, { data: { list: [{ nested: { value: "found-it" } }] } }],
      ]);
      expect(resolveVariableRefs("$0.data.list[0].nested.value", results)).toBe(
        "found-it",
      );
    });

    test("resolves $0.prop to object (preserves type)", () => {
      const results = new Map<number, any>([
        [0, { config: { a: 1, b: 2 } }],
      ]);
      expect(resolveVariableRefs("$0.config", results)).toEqual({ a: 1, b: 2 });
    });

    test("resolves $0.prop to array (preserves type)", () => {
      const results = new Map<number, any>([
        [0, { tags: ["prod", "us-east"] }],
      ]);
      expect(resolveVariableRefs("$0.tags", results)).toEqual(["prod", "us-east"]);
    });

    test("resolves path from different step index $1.id", () => {
      const results = new Map<number, any>([
        [0, { id: "zero" }],
        [1, { id: "one" }],
      ]);
      expect(resolveVariableRefs("$1.id", results)).toBe("one");
    });

    test("returns undefined for missing property", () => {
      const results = new Map<number, any>([[0, { id: "abc" }]]);
      expect(resolveVariableRefs("$0.nonExistent", results)).toBe(undefined);
    });

    test("returns undefined for path through null", () => {
      const results = new Map<number, any>([[0, { data: null }]]);
      expect(resolveVariableRefs("$0.data.name", results)).toBe(undefined);
    });

    test("returns undefined for out-of-bounds array index", () => {
      const results = new Map<number, any>([[0, [1, 2]]]);
      expect(resolveVariableRefs("$0[99]", results)).toBe(undefined);
    });
  });

  describe("property path access (embedded in string)", () => {
    test("resolves embedded $0.id in string", () => {
      const results = new Map<number, any>([[0, { id: "cls-123" }]]);
      expect(resolveVariableRefs("cluster/$0.id/details", results)).toBe(
        "cluster/cls-123/details",
      );
    });

    test("resolves multiple embedded refs with paths", () => {
      const results = new Map<number, any>([
        [0, { id: "proj-1" }],
        [1, { env: "prod" }],
      ]);
      expect(resolveVariableRefs("$0.id-$1.env", results)).toBe("proj-1-prod");
    });

    test("resolves embedded $0.data with object result (JSON stringified)", () => {
      const results = new Map<number, any>([
        [0, { data: { x: 1, y: 2 } }],
      ]);
      expect(resolveVariableRefs("payload=$0.data", results)).toBe(
        'payload={"x":1,"y":2}',
      );
    });

    test("resolves embedded $0[0] in string", () => {
      const results = new Map<number, any>([[0, ["first", "second"]]]);
      expect(resolveVariableRefs("item=$0[0]", results)).toBe("item=first");
    });

    test("resolves embedded $0.items[0].id in string", () => {
      const results = new Map<number, any>([
        [0, { items: [{ id: "item-abc" }] }],
      ]);
      expect(resolveVariableRefs("selected=$0.items[0].id", results)).toBe(
        "selected=item-abc",
      );
    });
  });

  describe("property path in nested structures", () => {
    test("resolves $0.id inside an object argument", () => {
      const results = new Map<number, any>([
        [0, { id: "cluster-xyz", region: "us-east" }],
      ]);
      const input = {
        clusterId: "$0.id",
        region: "$0.region",
        static: "unchanged",
      };
      expect(resolveVariableRefs(input, results)).toEqual({
        clusterId: "cluster-xyz",
        region: "us-east",
        static: "unchanged",
      });
    });

    test("resolves $0.id inside an array", () => {
      const results = new Map<number, any>([[0, { id: "abc" }]]);
      expect(resolveVariableRefs(["$0.id", "literal"], results)).toEqual([
        "abc",
        "literal",
      ]);
    });

    test("realistic plan: step creates resource, next step uses $0.id", () => {
      const results = new Map<number, any>([
        [0, { id: "res-001", status: "created", metadata: { zone: "az-1" } }],
      ]);
      const input = {
        resourceId: "$0.id",
        zone: "$0.metadata.zone",
        label: "resource-$0.id",
      };
      expect(resolveVariableRefs(input, results)).toEqual({
        resourceId: "res-001",
        zone: "az-1",
        label: "resource-res-001",
      });
    });
  });
});
