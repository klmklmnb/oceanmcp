import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { mkdtemp, rm, realpath, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createNodeSandbox } from "../src/ai/skills/sandbox";
import { discoverSkills } from "../src/ai/skills/discover";
import {
  loadSkillsFromZip,
  clearZipCache,
} from "../src/ai/skills/zip-loader";
import { createLoadSkillTool } from "../src/ai/skills/loader";
import {
  isCodeFunctionDefinition,
  wrapCodeFunctionDefinitions,
} from "../src/ai/skills/code-tool-adapter";
import { logger } from "../src/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests for CodeFunctionDefinition tools loaded from fixture files.
//
// Tests cover:
//   1. discoverSkills() loading fixture skill directories with tools.ts
//   2. loadSkillsFromZip() with zips containing CodeFunctionDefinition tools
//   3. Actual tool execution — invoking wrapped tools with args and checking results
//   4. Mixed tool type exports (AI SDK Tool + CodeFunctionDefinition)
//   5. loadSkill tool e2e (zip → discover → loadSkill → resource access)
//   6. Edge cases: error handling, browser global mocking, write tools
// ─────────────────────────────────────────────────────────────────────────────

// Paths to fixture skill directories
const FIXTURES_DIR = join(import.meta.dir, "fixtures/skills");

let tempDir: string;
let sandbox: ReturnType<typeof createNodeSandbox>;

beforeAll(async () => {
  const rawTemp = await mkdtemp(join(tmpdir(), "ocean-mcp-code-tools-test-"));
  tempDir = await realpath(rawTemp);
  sandbox = createNodeSandbox(tempDir);
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
  await clearZipCache();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Helper to call a tool's execute function with args */
async function execTool(
  tool: { execute?: Function },
  args: Record<string, any>,
): Promise<any> {
  if (!tool.execute) throw new Error("Tool has no execute function");
  return tool.execute(args, { toolCallId: "test", messages: [] });
}

/**
 * Read a fixture skill's tools.ts content as a string.
 * Used to embed the content into zip files.
 */
async function readFixtureFile(
  skillName: string,
  fileName: string,
): Promise<string> {
  return readFile(join(FIXTURES_DIR, skillName, fileName), "utf-8");
}

// ─── Programmatic ZIP builder (copied from skills-zip-loader.test.ts) ────────

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipBuffer(
  files: Record<string, string>,
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const entries: { name: Uint8Array; data: Uint8Array; offset: number }[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  const dirPaths = new Set<string>();
  for (const relativePath of Object.keys(files)) {
    const parts = relativePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirPaths.add(parts.slice(0, i).join("/") + "/");
    }
  }

  for (const dirPath of [...dirPaths].sort()) {
    const nameBytes = encoder.encode(dirPath);
    const header = new ArrayBuffer(30 + nameBytes.length);
    const hView = new DataView(header);
    hView.setUint32(0, 0x04034b50, true);
    hView.setUint16(4, 20, true);
    hView.setUint16(8, 0, true);
    hView.setUint16(26, nameBytes.length, true);
    new Uint8Array(header).set(nameBytes, 30);
    const headerBytes = new Uint8Array(header);
    entries.push({ name: nameBytes, data: new Uint8Array(0), offset });
    chunks.push(headerBytes);
    offset += headerBytes.length;
  }

  for (const [relativePath, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(relativePath);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const header = new ArrayBuffer(30 + nameBytes.length);
    const hView = new DataView(header);
    hView.setUint32(0, 0x04034b50, true);
    hView.setUint16(4, 20, true);
    hView.setUint16(8, 0, true);
    hView.setUint32(14, checksum, true);
    hView.setUint32(18, data.length, true);
    hView.setUint32(22, data.length, true);
    hView.setUint16(26, nameBytes.length, true);
    new Uint8Array(header).set(nameBytes, 30);
    const headerBytes = new Uint8Array(header);
    entries.push({ name: nameBytes, data, offset });
    chunks.push(headerBytes, data);
    offset += headerBytes.length + data.length;
  }

  const cdStart = offset;
  for (const entry of entries) {
    const cd = new ArrayBuffer(46 + entry.name.length);
    const cdView = new DataView(cd);
    cdView.setUint32(0, 0x02014b50, true);
    cdView.setUint16(4, 20, true);
    cdView.setUint16(6, 20, true);
    cdView.setUint16(8, 0, true);
    cdView.setUint16(10, 0, true);
    const checksum = entry.data.length > 0 ? crc32(entry.data) : 0;
    cdView.setUint32(16, checksum, true);
    cdView.setUint32(20, entry.data.length, true);
    cdView.setUint32(24, entry.data.length, true);
    cdView.setUint16(28, entry.name.length, true);
    cdView.setUint32(42, entry.offset, true);
    new Uint8Array(cd).set(entry.name, 46);
    const cdBytes = new Uint8Array(cd);
    chunks.push(cdBytes);
    offset += cdBytes.length;
  }

  const cdSize = offset - cdStart;
  const eocd = new ArrayBuffer(22);
  const eocdView = new DataView(eocd);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, cdStart, true);
  chunks.push(new Uint8Array(eocd));

  const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

async function createTestZip(
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const zipPath = join(tempDir, `${name}.zip`);
  const zipData = buildZipBuffer(files);
  await Bun.write(zipPath, zipData);
  return zipPath;
}

function serveFile(filePath: string): { url: string; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    async fetch() {
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(file);
    },
  });
  return {
    url: `http://localhost:${server.port}/skill.zip`,
    stop: () => server.stop(true),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Part 1: discoverSkills — fixture directories with CodeFunctionDefinition
// ═════════════════════════════════════════════════════════════════════════════

describe("discoverSkills — fixture skills with CodeFunctionDefinition tools", () => {
  test("discovers math-skill with 3 code tools", async () => {
    const skills = await discoverSkills(sandbox, [FIXTURES_DIR]);
    const math = skills.find((s) => s.name === "math-utils");

    expect(math).toBeDefined();
    expect(math!.tools).toBeDefined();
    expect(Object.keys(math!.tools!)).toContain("calculate");
    expect(Object.keys(math!.tools!)).toContain("statistics");
    expect(Object.keys(math!.tools!)).toContain("formatNumber");
  });

  test("discovers all 6 fixture skills from the fixtures directory", async () => {
    const skills = await discoverSkills(sandbox, [FIXTURES_DIR]);
    const names = skills.map((s) => s.name).sort();

    expect(names).toContain("math-utils");
    expect(names).toContain("string-utils");
    expect(names).toContain("json-utils");
    expect(names).toContain("date-utils");
    expect(names).toContain("mixed-tools-demo");
    expect(names).toContain("http-tools");
  });

  test("mixed-tools skill has both AI SDK tool and code tools", async () => {
    const skills = await discoverSkills(sandbox, [FIXTURES_DIR]);
    const mixed = skills.find((s) => s.name === "mixed-tools-demo");

    expect(mixed).toBeDefined();
    expect(mixed!.tools).toBeDefined();

    const toolNames = Object.keys(mixed!.tools!);
    expect(toolNames).toContain("echo"); // AI SDK tool
    expect(toolNames).toContain("encodeBase64"); // CodeFunctionDefinition
    expect(toolNames).toContain("decodeBase64"); // CodeFunctionDefinition
    expect(toolNames).toContain("generateUUID"); // CodeFunctionDefinition
  });

  test("http-tools skill has 3 fetch-based code tools", async () => {
    const skills = await discoverSkills(sandbox, [FIXTURES_DIR]);
    const http = skills.find((s) => s.name === "http-tools");

    expect(http).toBeDefined();
    expect(http!.tools).toBeDefined();
    expect(Object.keys(http!.tools!)).toContain("httpGet");
    expect(Object.keys(http!.tools!)).toContain("checkUrl");
    expect(Object.keys(http!.tools!)).toContain("fetchJson");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Part 2: Tool execution — math-skill tools
// ═════════════════════════════════════════════════════════════════════════════

describe("math-skill tool execution", () => {
  let tools: Record<string, any>;

  beforeAll(async () => {
    const skills = await discoverSkills(sandbox, [FIXTURES_DIR]);
    tools = skills.find((s) => s.name === "math-utils")!.tools!;
  });

  test("calculate — addition", async () => {
    const result = await execTool(tools.calculate, {
      a: 7,
      b: 3,
      operation: "add",
    });
    expect(result.result).toBe(10);
    expect(result.expression).toBe("7 + 3 = 10");
  });

  test("calculate — subtraction", async () => {
    const result = await execTool(tools.calculate, {
      a: 10,
      b: 4,
      operation: "subtract",
    });
    expect(result.result).toBe(6);
  });

  test("calculate — multiplication", async () => {
    const result = await execTool(tools.calculate, {
      a: 6,
      b: 7,
      operation: "multiply",
    });
    expect(result.result).toBe(42);
  });

  test("calculate — division", async () => {
    const result = await execTool(tools.calculate, {
      a: 15,
      b: 4,
      operation: "divide",
    });
    expect(result.result).toBe(3.75);
  });

  test("calculate — division by zero returns error", async () => {
    const result = await execTool(tools.calculate, {
      a: 10,
      b: 0,
      operation: "divide",
    });
    expect(result.error).toBe("Division by zero");
  });

  test("calculate — unknown operation returns error", async () => {
    const result = await execTool(tools.calculate, {
      a: 1,
      b: 2,
      operation: "power",
    });
    expect(result.error).toBe("Unknown operation: power");
  });

  test("statistics — computes correct stats for number array", async () => {
    const result = await execTool(tools.statistics, {
      numbers: [3, 7, 1, 9, 5],
    });
    expect(result.count).toBe(5);
    expect(result.sum).toBe(25);
    expect(result.mean).toBe(5);
    expect(result.median).toBe(5);
    expect(result.min).toBe(1);
    expect(result.max).toBe(9);
    expect(result.range).toBe(8);
  });

  test("statistics — single element array", async () => {
    const result = await execTool(tools.statistics, {
      numbers: [42],
    });
    expect(result.count).toBe(1);
    expect(result.mean).toBe(42);
    expect(result.median).toBe(42);
    expect(result.min).toBe(42);
    expect(result.max).toBe(42);
  });

  test("statistics — even-length array median", async () => {
    const result = await execTool(tools.statistics, {
      numbers: [2, 4, 6, 8],
    });
    expect(result.median).toBe(5); // (4+6)/2
  });

  test("statistics — empty array returns error", async () => {
    const result = await execTool(tools.statistics, { numbers: [] });
    expect(result.error).toBe("No numbers provided");
  });

  test("formatNumber — basic formatting with thousands separator", async () => {
    const result = await execTool(tools.formatNumber, {
      value: 1234567.89,
    });
    expect(result.formatted).toBe("1,234,567.89");
    expect(result.original).toBe(1234567.89);
  });

  test("formatNumber — with decimals and prefix", async () => {
    const result = await execTool(tools.formatNumber, {
      value: 1234567.89,
      decimals: 2,
      prefix: "$",
    });
    expect(result.formatted).toBe("$1,234,567.89");
  });

  test("formatNumber — with suffix", async () => {
    const result = await execTool(tools.formatNumber, {
      value: 95.5,
      decimals: 1,
      suffix: "%",
    });
    expect(result.formatted).toBe("95.5%");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Part 3: Tool execution — string-utils tools
// ═════════════════════════════════════════════════════════════════════════════

describe("string-utils tool execution", () => {
  let tools: Record<string, any>;

  beforeAll(async () => {
    const skills = await discoverSkills(sandbox, [FIXTURES_DIR]);
    tools = skills.find((s) => s.name === "string-utils")!.tools!;
  });

  test("transformString — uppercase", async () => {
    const result = await execTool(tools.transformString, {
      text: "hello world",
      transform: "uppercase",
    });
    expect(result.result).toBe("HELLO WORLD");
  });

  test("transformString — lowercase", async () => {
    const result = await execTool(tools.transformString, {
      text: "Hello World",
      transform: "lowercase",
    });
    expect(result.result).toBe("hello world");
  });

  test("transformString — camelCase", async () => {
    const result = await execTool(tools.transformString, {
      text: "hello world foo",
      transform: "camelCase",
    });
    expect(result.result).toBe("helloWorldFoo");
  });

  test("transformString — snake_case", async () => {
    const result = await execTool(tools.transformString, {
      text: "Hello World Foo",
      transform: "snake_case",
    });
    expect(result.result).toBe("hello_world_foo");
  });

  test("transformString — kebab-case", async () => {
    const result = await execTool(tools.transformString, {
      text: "Hello World Foo",
      transform: "kebab-case",
    });
    expect(result.result).toBe("hello-world-foo");
  });

  test("transformString — titleCase", async () => {
    const result = await execTool(tools.transformString, {
      text: "hello world foo",
      transform: "titleCase",
    });
    expect(result.result).toBe("Hello World Foo");
  });

  test("analyzeString — counts chars, words, lines", async () => {
    const result = await execTool(tools.analyzeString, {
      text: "Hello world!\nSecond line.",
    });
    expect(result.characters).toBe(25);
    expect(result.words).toBe(4); // "Hello", "world!", "Second", "line."
    expect(result.lines).toBe(2);
    expect(result.sentences).toBe(2); // ! and .
  });

  test("analyzeString — detects patterns", async () => {
    const result = await execTool(tools.analyzeString, {
      text: "Contact user@example.com or visit https://example.com. Phone: 123.",
    });
    expect(result.hasNumbers).toBe(true);
    expect(result.hasEmails).toBe(true);
    expect(result.hasUrls).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Part 4: Tool execution — json-utils tools
// ═════════════════════════════════════════════════════════════════════════════

describe("json-utils tool execution", () => {
  let tools: Record<string, any>;

  beforeAll(async () => {
    const skills = await discoverSkills(sandbox, [FIXTURES_DIR]);
    tools = skills.find((s) => s.name === "json-utils")!.tools!;
  });

  test("jsonQuery — dot-notation path extraction", async () => {
    const result = await execTool(tools.jsonQuery, {
      json: { data: { users: [{ name: "Alice" }, { name: "Bob" }] } },
      path: "data.users[0].name",
    });
    expect(result.value).toBe("Alice");
    expect(result.found).toBe(true);
  });

  test("jsonQuery — non-existent path returns found=false", async () => {
    const result = await execTool(tools.jsonQuery, {
      json: { a: 1 },
      path: "b.c.d",
    });
    expect(result.found).toBe(false);
  });

  test("jsonQuery — accepts JSON string input", async () => {
    const result = await execTool(tools.jsonQuery, {
      json: '{"x": 42}',
      path: "x",
    });
    expect(result.value).toBe(42);
    expect(result.found).toBe(true);
  });

  test("jsonTransform — pick keys", async () => {
    const result = await execTool(tools.jsonTransform, {
      json: { a: 1, b: 2, c: 3, d: 4 },
      operation: "pick",
      keys: ["a", "c"],
    });
    expect(result.result).toEqual({ a: 1, c: 3 });
  });

  test("jsonTransform — omit keys", async () => {
    const result = await execTool(tools.jsonTransform, {
      json: { a: 1, b: 2, c: 3 },
      operation: "omit",
      keys: ["b"],
    });
    expect(result.result).toEqual({ a: 1, c: 3 });
  });

  test("jsonTransform — flatten nested object", async () => {
    const result = await execTool(tools.jsonTransform, {
      json: { a: { b: { c: 1 }, d: 2 }, e: 3 },
      operation: "flatten",
    });
    expect(result.result).toEqual({
      "a.b.c": 1,
      "a.d": 2,
      "e": 3,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Part 5: Tool execution — date-utils tools
// ═════════════════════════════════════════════════════════════════════════════

describe("date-utils tool execution", () => {
  let tools: Record<string, any>;

  beforeAll(async () => {
    const skills = await discoverSkills(sandbox, [FIXTURES_DIR]);
    tools = skills.find((s) => s.name === "date-utils")!.tools!;
  });

  test("dateInfo — current date (no args)", async () => {
    const result = await execTool(tools.dateInfo, {});
    expect(result.iso).toBeDefined();
    expect(result.year).toBeGreaterThanOrEqual(2026);
    expect(result.dayOfWeek).toBeDefined();
    expect(result.isLeapYear).toBeDefined();
  });

  test("dateInfo — parse a specific date", async () => {
    const result = await execTool(tools.dateInfo, {
      date: "2024-02-29T12:00:00Z",
    });
    expect(result.year).toBe(2024);
    expect(result.month).toBe(2);
    expect(result.day).toBe(29);
    expect(result.isLeapYear).toBe(true);
  });

  test("dateInfo — invalid date returns error", async () => {
    const result = await execTool(tools.dateInfo, { date: "not-a-date" });
    expect(result.error).toContain("Invalid date");
  });

  test("dateDiff — calculates difference between two dates", async () => {
    const result = await execTool(tools.dateDiff, {
      from: "2024-01-01T00:00:00Z",
      to: "2024-01-08T12:30:00Z",
    });
    expect(result.direction).toBe("forward");
    expect(result.breakdown.days).toBe(7);
    expect(result.breakdown.hours).toBe(12);
    expect(result.breakdown.minutes).toBe(30);
    expect(result.humanReadable).toContain("7d");
  });

  test("dateDiff — backward direction", async () => {
    const result = await execTool(tools.dateDiff, {
      from: "2024-12-31",
      to: "2024-01-01",
    });
    expect(result.direction).toBe("backward");
    expect(result.totalDays).toBeGreaterThan(0); // absolute value
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Part 6: Tool execution — mixed-tools skill (AI SDK + CodeFunctionDefinition)
// ═════════════════════════════════════════════════════════════════════════════

describe("mixed-tools-demo tool execution", () => {
  let tools: Record<string, any>;

  beforeAll(async () => {
    const skills = await discoverSkills(sandbox, [FIXTURES_DIR]);
    tools = skills.find((s) => s.name === "mixed-tools-demo")!.tools!;
  });

  test("echo (AI SDK tool) — returns text and metadata", async () => {
    const result = await execTool(tools.echo, { text: "hello" });
    expect(result.echo).toBe("hello");
    expect(result.length).toBe(5);
    expect(result.timestamp).toBeDefined();
  });

  test("echo (AI SDK tool) — uppercase option", async () => {
    const result = await execTool(tools.echo, {
      text: "hello",
      uppercase: true,
    });
    expect(result.echo).toBe("HELLO");
  });

  test("encodeBase64 (code tool) — encodes text", async () => {
    const result = await execTool(tools.encodeBase64, { text: "hello world" });
    expect(result.encoded).toBe("aGVsbG8gd29ybGQ=");
    expect(result.original).toBe("hello world");
  });

  test("decodeBase64 (code tool) — decodes back", async () => {
    const result = await execTool(tools.decodeBase64, {
      encoded: "aGVsbG8gd29ybGQ=",
    });
    expect(result.decoded).toBe("hello world");
  });

  test("encodeBase64 → decodeBase64 round-trip", async () => {
    const original = "The quick brown fox 123 !@#";
    const encoded = await execTool(tools.encodeBase64, { text: original });
    const decoded = await execTool(tools.decodeBase64, {
      encoded: encoded.encoded,
    });
    expect(decoded.decoded).toBe(original);
  });

  test("decodeBase64 — invalid input returns error", async () => {
    const result = await execTool(tools.decodeBase64, {
      encoded: "!!!invalid!!!",
    });
    expect(result.error).toContain("Invalid Base64");
  });

  test("generateUUID (code tool) — single UUID", async () => {
    const result = await execTool(tools.generateUUID, {});
    expect(result.uuid).toBeDefined();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(result.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("generateUUID (code tool) — multiple UUIDs", async () => {
    const result = await execTool(tools.generateUUID, { count: 5 });
    expect(result.uuids).toHaveLength(5);
    expect(result.count).toBe(5);
    // All should be unique
    const unique = new Set(result.uuids);
    expect(unique.size).toBe(5);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Part 7: loadSkillsFromZip — root-level skill with CodeFunctionDefinition
// ═════════════════════════════════════════════════════════════════════════════

describe("loadSkillsFromZip — root-level fixture skills with code tools", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("root-level math-skill zip: tools are imported and executable", async () => {
    const skillMd = await readFixtureFile("math-skill", "SKILL.md");
    const toolsTs = await readFixtureFile("math-skill", "tools.ts");

    const zipPath = await createTestZip("zip-math-root", {
      "SKILL.md": skillMd,
      "tools.ts": toolsTs,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("math-utils");
      expect(skills[0].tools).toBeDefined();
      expect(Object.keys(skills[0].tools!)).toContain("calculate");
      expect(Object.keys(skills[0].tools!)).toContain("statistics");
      expect(Object.keys(skills[0].tools!)).toContain("formatNumber");

      // Execute a tool to verify it works
      const result = await execTool(skills[0].tools!.calculate, {
        a: 6,
        b: 7,
        operation: "multiply",
      });
      expect(result.result).toBe(42);
    } finally {
      stop();
    }
  });

  test("root-level mixed-tools zip: AI SDK + code tools coexist", async () => {
    // NOTE: For zip-extracted tools.ts, `import { tool } from "ai"` only works
    // when the extraction directory can resolve npm modules. In this test we use
    // inline content with only CodeFunctionDefinition tools (no npm imports)
    // since the zip is extracted to /tmp. The discoverSkills test above covers
    // the mixed case (fixture directory is within the project tree).
    //
    // Here we test that a zip with ONLY CodeFunctionDefinition tools works.
    const zipPath = await createTestZip("zip-code-only-root", {
      "SKILL.md": `---
name: code-only-demo
description: Skill with only code tools.
---

# Code Only Demo
`,
      "tools.ts": `
export default {
  greet: {
    id: "greet",
    name: "Greet",
    description: "Returns a greeting",
    type: "code",
    operationType: "read",
    code: 'return { message: "Hello, " + args.name + "!" }',
    parameters: [
      { name: "name", type: "string", description: "Name to greet", required: true },
    ],
  },
  addNumbers: {
    id: "addNumbers",
    name: "Add Numbers",
    description: "Adds two numbers",
    type: "code",
    operationType: "read",
    code: 'return { sum: args.a + args.b }',
    parameters: [
      { name: "a", type: "number", description: "First", required: true },
      { name: "b", type: "number", description: "Second", required: true },
    ],
  },
};
`,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("code-only-demo");
      expect(skills[0].tools).toBeDefined();

      const toolNames = Object.keys(skills[0].tools!);
      expect(toolNames).toContain("greet");
      expect(toolNames).toContain("addNumbers");

      // Execute tools
      const greetResult = await execTool(skills[0].tools!.greet, {
        name: "World",
      });
      expect(greetResult.message).toBe("Hello, World!");

      const addResult = await execTool(skills[0].tools!.addNumbers, {
        a: 3,
        b: 7,
      });
      expect(addResult.sum).toBe(10);
    } finally {
      stop();
    }
  });

  test("root-level http-tools zip: fetch-based tools + resources", async () => {
    const skillMd = await readFixtureFile("http-tools", "SKILL.md");
    const toolsTs = await readFixtureFile("http-tools", "tools.ts");
    const apiExamples = await readFixtureFile(
      "http-tools",
      "references/api-examples.md",
    );

    const zipPath = await createTestZip("zip-http-root", {
      "SKILL.md": skillMd,
      "tools.ts": toolsTs,
      "references/api-examples.md": apiExamples,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("http-tools");
      expect(skills[0].tools).toBeDefined();

      const toolNames = Object.keys(skills[0].tools!);
      expect(toolNames).toContain("httpGet");
      expect(toolNames).toContain("checkUrl");
      expect(toolNames).toContain("fetchJson");

      // The tools have execute functions (even if we don't call real URLs here)
      expect(skills[0].tools!.httpGet.execute).toBeDefined();
      expect(skills[0].tools!.checkUrl.execute).toBeDefined();
      expect(skills[0].tools!.fetchJson.execute).toBeDefined();
    } finally {
      stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Part 8: loadSkillsFromZip — subdirectory skills with code tools
// ═════════════════════════════════════════════════════════════════════════════

describe("loadSkillsFromZip — subdirectory fixture skills with code tools", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("multi-skill zip: discovers all subdirectory skills with tools", async () => {
    const files: Record<string, string> = {};

    for (const skillName of ["string-utils", "json-utils", "date-utils"]) {
      files[`${skillName}/SKILL.md`] = await readFixtureFile(
        skillName,
        "SKILL.md",
      );
      files[`${skillName}/tools.ts`] = await readFixtureFile(
        skillName,
        "tools.ts",
      );
    }

    const zipPath = await createTestZip("zip-multi-subdir", files);

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(3);
      const names = skills.map((s) => s.name).sort();
      expect(names).toEqual(["date-utils", "json-utils", "string-utils"]);

      // Each skill should have tools
      for (const skill of skills) {
        expect(skill.tools).toBeDefined();
        expect(Object.keys(skill.tools!).length).toBeGreaterThan(0);
      }

      // Execute a string tool
      const stringSkill = skills.find((s) => s.name === "string-utils")!;
      const result = await execTool(stringSkill.tools!.transformString, {
        text: "hello world",
        transform: "uppercase",
      });
      expect(result.result).toBe("HELLO WORLD");

      // Execute a json tool
      const jsonSkill = skills.find((s) => s.name === "json-utils")!;
      const jsonResult = await execTool(jsonSkill.tools!.jsonQuery, {
        json: { foo: { bar: 42 } },
        path: "foo.bar",
      });
      expect(jsonResult.value).toBe(42);

      // Execute a date tool
      const dateSkill = skills.find((s) => s.name === "date-utils")!;
      const dateResult = await execTool(dateSkill.tools!.dateInfo, {
        date: "2024-06-15",
      });
      expect(dateResult.year).toBe(2024);
      expect(dateResult.month).toBe(6);
    } finally {
      stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Part 9: loadSkill tool e2e — zip with code tools + resource files
// ═════════════════════════════════════════════════════════════════════════════

describe("loadSkill tool e2e — zip with code tools + resources", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("loadSkill returns instructions and resource listing for zip skill with code tools", async () => {
    const skillMd = await readFixtureFile("http-tools", "SKILL.md");
    const toolsTs = await readFixtureFile("http-tools", "tools.ts");
    const apiExamples = await readFixtureFile(
      "http-tools",
      "references/api-examples.md",
    );

    const zipPath = await createTestZip("zip-e2e-loadskill", {
      "SKILL.md": skillMd,
      "tools.ts": toolsTs,
      "references/api-examples.md": apiExamples,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);
      expect(skills).toHaveLength(1);

      // Create the loadSkill tool with discovered zip skills
      const loadSkill = createLoadSkillTool(sandbox, skills, []);

      // Load the skill instructions
      const result = (await loadSkill.execute!(
        { name: "http-tools" },
        { toolCallId: "test", messages: [] } as any,
      )) as any;

      // Should have instructions (SKILL.md body without frontmatter)
      expect(result.content).toContain("# HTTP Tools");
      expect(result.content).toContain("httpGet");
      expect(result.skillDirectory).toBeDefined();

      // Should list resources (excluding SKILL.md and tools.ts)
      expect(result.resources).toBeDefined();
      expect(result.resources).toContain("references/");
      expect(result.resources).toContain("references/api-examples.md");
      // tools.ts and SKILL.md should be excluded from resources
      expect(result.resources).not.toContain("tools.ts");
      expect(result.resources).not.toContain("SKILL.md");

      // Load a specific resource file
      const resourceResult = (await loadSkill.execute!(
        { name: "http-tools", resourcePath: "references/api-examples.md" },
        { toolCallId: "test2", messages: [] } as any,
      )) as any;

      expect(resourceResult.content).toContain("httpbin.org");
      expect(resourceResult.content).toContain("JSONPlaceholder");
      expect(resourceResult.resourcePath).toBe("references/api-examples.md");
    } finally {
      stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Part 10: Edge cases and error handling
// ═════════════════════════════════════════════════════════════════════════════

describe("CodeFunctionDefinition edge cases", () => {
  test("code tool accessing window/document logs warnings but does not crash", async () => {
    const warnings: string[] = [];
    const originalWarn = logger.warn.bind(logger);
    logger.warn = ((...args: any[]) => { warnings.push(args.map(String).join(" ")); return logger; }) as any;

    try {
      const exports = wrapCodeFunctionDefinitions({
        browserTool: {
          id: "browserTool",
          name: "Browser Tool",
          description: "Uses browser globals",
          type: "code",
          operationType: "read",
          code: `
            const href = window.location;
            const title = document.title;
            return { href, title };
          `,
          parameters: [],
        },
      });

      const result = await execTool(exports.browserTool, {});

      // Should not crash, values are undefined
      expect(result.href).toBeUndefined();
      expect(result.title).toBeUndefined();

      // Should have logged warnings
      expect(
        warnings.some((w) => w.includes("window.location")),
      ).toBe(true);
      expect(
        warnings.some((w) => w.includes("document.title")),
      ).toBe(true);
    } finally {
      logger.warn = originalWarn;
    }
  });

  test("code tool with runtime error throws descriptive error", async () => {
    const exports = wrapCodeFunctionDefinitions({
      errorTool: {
        id: "errorTool",
        name: "Error Tool",
        description: "Throws at runtime",
        type: "code",
        operationType: "read",
        code: `throw new Error("intentional failure")`,
        parameters: [],
      },
    });

    await expect(execTool(exports.errorTool, {})).rejects.toThrow(
      "Code tool execution failed: intentional failure",
    );
  });

  test("code tool with syntax error in code string throws", async () => {
    const exports = wrapCodeFunctionDefinitions({
      syntaxError: {
        id: "syntaxError",
        name: "Syntax Error Tool",
        description: "Has invalid syntax",
        type: "code",
        operationType: "read",
        code: `return {{{`,
        parameters: [],
      },
    });

    await expect(execTool(exports.syntaxError, {})).rejects.toThrow();
  });

  test("code tool returning undefined is handled", async () => {
    const exports = wrapCodeFunctionDefinitions({
      undefinedTool: {
        id: "undefinedTool",
        name: "Undefined Tool",
        description: "Returns nothing",
        type: "code",
        operationType: "read",
        code: `const x = 1;`,
        parameters: [],
      },
    });

    const result = await execTool(exports.undefinedTool, {});
    expect(result).toBeUndefined();
  });

  test("code tool can use modern JS features (destructuring, spread, template literals)", async () => {
    const exports = wrapCodeFunctionDefinitions({
      modernTool: {
        id: "modernTool",
        name: "Modern Tool",
        description: "Uses modern JS",
        type: "code",
        operationType: "read",
        code: `
          const { x, y, ...rest } = args;
          const arr = [1, 2, ...[3, 4]];
          return { 
            greeting: \`Hello \${x}\`,
            sum: arr.reduce((a, b) => a + b, 0),
            restKeys: Object.keys(rest),
          };
        `,
        parameters: [
          { name: "x", type: "string", description: "X", required: true },
          { name: "y", type: "number", description: "Y", required: true },
          { name: "extra", type: "string", description: "Extra", required: false },
        ],
      },
    });

    const result = await execTool(exports.modernTool, {
      x: "World",
      y: 42,
      extra: "bonus",
    });
    expect(result.greeting).toBe("Hello World");
    expect(result.sum).toBe(10);
    expect(result.restKeys).toContain("extra");
  });

  test("zip without tools.ts still discovers skill correctly", async () => {
    await clearZipCache();

    const zipPath = await createTestZip("zip-no-tools", {
      "SKILL.md": `---
name: prompt-only
description: A skill with no tools.
---

# Prompt Only Skill
`,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("prompt-only");
      expect(skills[0].tools).toBeUndefined();
    } finally {
      stop();
    }
  });

  test("isCodeFunctionDefinition correctly rejects AI SDK tool instances", () => {
    const { tool } = require("ai");
    const { z } = require("zod");

    const aiTool = tool({
      description: "test",
      inputSchema: z.object({}),
      execute: async () => "ok",
    });

    expect(isCodeFunctionDefinition(aiTool)).toBe(false);
  });

  test("wrapCodeFunctionDefinitions preserves tool descriptions", () => {
    const exports = wrapCodeFunctionDefinitions({
      myTool: {
        id: "myTool",
        name: "My Tool",
        description: "Very specific description for testing",
        type: "code",
        operationType: "read",
        code: 'return "ok"',
        parameters: [],
      },
    });

    expect(exports.myTool.description).toBe(
      "Very specific description for testing",
    );
  });
});
