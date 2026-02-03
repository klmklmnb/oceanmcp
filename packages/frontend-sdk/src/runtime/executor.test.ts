import { describe, it, expect } from "vitest";
import { substituteReferences } from "./executor";

describe("substituteReferences", () => {
  describe("basic reference substitution", () => {
    it("should substitute $0 with the first result", () => {
      const args = { value: "$0" };
      const previousResults = [{ data: { id: "1234" } }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: { data: { id: "1234" } } });
    });

    it("should substitute $1 with the second result", () => {
      const args = { value: "$1" };
      const previousResults = ["first", "second", "third"];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: "second" });
    });

    it("should handle multiple references in different keys", () => {
      const args = { first: "$0", second: "$1" };
      const previousResults = ["result0", "result1"];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ first: "result0", second: "result1" });
    });
  });

  describe("path navigation with dot notation", () => {
    it("should navigate simple property path $0.data", () => {
      const args = { value: "$0.data" };
      const previousResults = [{ data: { id: "1234" } }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: { id: "1234" } });
    });

    it("should navigate nested property path $0.data.id", () => {
      const args = { cluster_id: "$0.data.id" };
      const previousResults = [{ data: { id: "1234" } }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ cluster_id: "1234" });
    });

    it("should handle deeply nested paths", () => {
      const args = { value: "$0.level1.level2.level3.value" };
      const previousResults = [
        { level1: { level2: { level3: { value: "deep" } } } },
      ];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: "deep" });
    });
  });

  describe("array index access", () => {
    it("should access array element with [index]", () => {
      const args = { value: "$0[0]" };
      const previousResults = [["first", "second", "third"]];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: "first" });
    });

    it("should access different array indices", () => {
      const args = { first: "$0[0]", second: "$0[1]", third: "$0[2]" };
      const previousResults = [["a", "b", "c"]];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ first: "a", second: "b", third: "c" });
    });
  });

  describe("combined property and array access", () => {
    it("should handle $0.items[0]", () => {
      const args = { value: "$0.items[0]" };
      const previousResults = [{ items: ["first", "second"] }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: "first" });
    });

    it("should handle $0.items[0].name", () => {
      const args = { value: "$0.items[0].name" };
      const previousResults = [{ items: [{ name: "Alice" }, { name: "Bob" }] }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: "Alice" });
    });

    it("should handle $0[0].nested.value", () => {
      const args = { value: "$0[0].nested.value" };
      const previousResults = [[{ nested: { value: "found" } }]];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: "found" });
    });

    it("should handle complex path $0.data.clusters[0].id", () => {
      const args = { cluster_id: "$0.data.clusters[0].id" };
      const previousResults = [
        { data: { clusters: [{ id: "cluster-1" }, { id: "cluster-2" }] } },
      ];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ cluster_id: "cluster-1" });
    });
  });

  describe("user's example scenario", () => {
    it("should correctly substitute $0.data.id in a multi-step flow", () => {
      // Step 0 result: createClusterLML => {data: {id: "1234"}}
      const step0Result = { data: { id: "1234" } };

      // Step 1 args: getDeployGroupsLML(env: "testing", cluster_id: "$0.data.id")
      const step1Args = { env: "testing", cluster_id: "$0.data.id" };
      const step1Resolved = substituteReferences(step1Args, [step0Result]);

      expect(step1Resolved).toEqual({ env: "testing", cluster_id: "1234" });

      // Step 2 args: createDeployGroupLML with multiple fields
      const step2Args = {
        domain: "wb-test.mihoyo.com",
        public_path: "/dxtest",
        bucket_tag: "external_network",
        cluster_env: "testing",
        cluster_id: "$0.data.id",
        cluster_tag: undefined,
        group_name: "test",
      };
      const step2Resolved = substituteReferences(step2Args, [step0Result]);

      expect(step2Resolved).toEqual({
        domain: "wb-test.mihoyo.com",
        public_path: "/dxtest",
        bucket_tag: "external_network",
        cluster_env: "testing",
        cluster_id: "1234",
        cluster_tag: undefined,
        group_name: "test",
      });
    });
  });

  describe("edge cases", () => {
    it("should return undefined for out-of-bounds index", () => {
      const args = { value: "$5" };
      const previousResults = ["only one"];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: undefined });
    });

    it("should return undefined for invalid path on result", () => {
      const args = { value: "$0.nonexistent.path" };
      const previousResults = [{ data: { id: "1234" } }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: undefined });
    });

    it("should preserve non-reference strings", () => {
      const args = { env: "testing", name: "my-cluster" };
      const previousResults = [{ data: { id: "1234" } }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ env: "testing", name: "my-cluster" });
    });

    it("should preserve non-string values", () => {
      const args = { count: 42, enabled: true, items: [1, 2, 3] };
      const previousResults = [{ data: { id: "1234" } }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ count: 42, enabled: true, items: [1, 2, 3] });
    });

    it("should handle null in previousResults", () => {
      const args = { value: "$0.data" };
      const previousResults = [null];

      const result = substituteReferences(args, previousResults);

      // When previousResults[0] is null, path navigation stops and returns null
      expect(result).toEqual({ value: null });
    });

    it("should handle empty previousResults", () => {
      const args = { value: "$0.data" };
      const previousResults: unknown[] = [];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: undefined });
    });

    it("should preserve strings starting with $ but not matching pattern", () => {
      const args = { variable: "$env", dollarSign: "$abc" };
      const previousResults = [{ data: "test" }];

      const result = substituteReferences(args, previousResults);

      // $env and $abc don't match ^\$(\d+)(.*)$ pattern (not starting with digits)
      expect(result).toEqual({ variable: "$env", dollarSign: "$abc" });
    });

    it("should treat $N as reference even without path", () => {
      const args = { currency: "$100" };
      const previousResults = [{ data: "test" }];

      const result = substituteReferences(args, previousResults);

      // $100 matches pattern as index=100 with empty path, returns undefined (out of bounds)
      expect(result).toEqual({ currency: undefined });
    });
  });

  describe("nested object substitution", () => {
    it("should substitute references in nested objects", () => {
      const args = {
        config: {
          cluster_id: "$0.data.id",
          name: "test",
        },
      };
      const previousResults = [{ data: { id: "1234" } }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({
        config: {
          cluster_id: "1234",
          name: "test",
        },
      });
    });

    it("should substitute references in deeply nested objects", () => {
      const args = {
        level1: {
          level2: {
            ref: "$0.value",
          },
        },
      };
      const previousResults = [{ value: "substituted" }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({
        level1: {
          level2: {
            ref: "substituted",
          },
        },
      });
    });
  });

  describe("referencing different step results", () => {
    it("should reference results from different steps", () => {
      const args = {
        fromStep0: "$0.id",
        fromStep1: "$1.name",
        fromStep2: "$2.value",
      };
      const previousResults = [
        { id: "id-from-0" },
        { name: "name-from-1" },
        { value: "value-from-2" },
      ];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({
        fromStep0: "id-from-0",
        fromStep1: "name-from-1",
        fromStep2: "value-from-2",
      });
    });
  });

  describe("array value handling", () => {
    it("should preserve arrays without references", () => {
      const args = { items: [1, 2, 3] };
      const previousResults = [{ data: "test" }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it("should handle arrays with object elements containing references", () => {
      const args = {
        configs: [
          { id: "$0.id", name: "first" },
          { id: "$1.id", name: "second" },
        ],
      };
      const previousResults = [{ id: "id-0" }, { id: "id-1" }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({
        configs: [
          { id: "id-0", name: "first" },
          { id: "id-1", name: "second" },
        ],
      });
    });

    it("should preserve primitive array elements", () => {
      const args = { tags: ["tag1", "tag2", "tag3"] };
      const previousResults = [{ data: "test" }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ tags: ["tag1", "tag2", "tag3"] });
    });

    it("should handle string references directly in arrays", () => {
      const args = { ids: ["$0.id", "$1.id"] };
      const previousResults = [{ id: "first-id" }, { id: "second-id" }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ ids: ["first-id", "second-id"] });
    });

    it("should handle mixed array elements", () => {
      const args = { values: ["$0.name", 42, { ref: "$1.value" }, "static"] };
      const previousResults = [{ name: "Alice" }, { value: "dynamic" }];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({
        values: ["Alice", 42, { ref: "dynamic" }, "static"],
      });
    });
  });

  describe("primitive result values", () => {
    it("should handle string result", () => {
      const args = { value: "$0" };
      const previousResults = ["just a string"];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: "just a string" });
    });

    it("should handle number result", () => {
      const args = { value: "$0" };
      const previousResults = [42];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: 42 });
    });

    it("should handle boolean result", () => {
      const args = { value: "$0" };
      const previousResults = [true];

      const result = substituteReferences(args, previousResults);

      expect(result).toEqual({ value: true });
    });
  });
});
