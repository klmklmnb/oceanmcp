import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, realpath, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createNodeSandbox } from "../src/ai/skills/sandbox";
import { loadSkillsFromZip } from "../src/ai/skills/zip-loader";

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests for loadSkillsFromZip
//
// These tests create real zip files on disk, serve them via a local HTTP
// server, and verify the full download → extract → discover pipeline.
//
// Each test creates a specific directory structure, zips it, then calls
// loadSkillsFromZip with a file:// URL or a local HTTP server.
// ─────────────────────────────────────────────────────────────────────────────

let tempDir: string;
let sandbox: ReturnType<typeof createNodeSandbox>;

beforeAll(async () => {
  const rawTemp = await mkdtemp(join(tmpdir(), "ocean-mcp-zip-test-"));
  tempDir = await realpath(rawTemp);
  sandbox = createNodeSandbox(tempDir);
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ─── Programmatic ZIP builder (no system `zip` binary needed) ────────────────

/** Pure-JS CRC-32 implementation (IEEE polynomial). */
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

/**
 * Build a ZIP file in memory from a map of { relativePath → content }.
 *
 * Uses the STORE method (no compression) which is sufficient for small test
 * fixtures and avoids any dependency on system binaries or npm packages.
 *
 * Returns the complete ZIP as a Uint8Array.
 */
function buildZipBuffer(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const entries: {
    name: Uint8Array;
    data: Uint8Array;
    offset: number;
  }[] = [];

  const chunks: Uint8Array[] = [];
  let offset = 0;

  // Collect all paths that need directory entries (including intermediate dirs)
  const dirPaths = new Set<string>();
  for (const relativePath of Object.keys(files)) {
    const parts = relativePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirPaths.add(parts.slice(0, i).join("/") + "/");
    }
  }

  // Write directory entries first
  for (const dirPath of [...dirPaths].sort()) {
    const nameBytes = encoder.encode(dirPath);

    // Local file header for directory
    const header = new ArrayBuffer(30 + nameBytes.length);
    const hView = new DataView(header);
    hView.setUint32(0, 0x04034b50, true);   // local file header signature
    hView.setUint16(4, 20, true);            // version needed (2.0)
    hView.setUint16(6, 0, true);             // general purpose bit flag
    hView.setUint16(8, 0, true);             // compression method: STORE
    hView.setUint16(10, 0, true);            // last mod file time
    hView.setUint16(12, 0, true);            // last mod file date
    hView.setUint32(14, 0, true);            // crc-32
    hView.setUint32(18, 0, true);            // compressed size
    hView.setUint32(22, 0, true);            // uncompressed size
    hView.setUint16(26, nameBytes.length, true); // file name length
    hView.setUint16(28, 0, true);            // extra field length
    new Uint8Array(header).set(nameBytes, 30);

    const headerBytes = new Uint8Array(header);
    entries.push({ name: nameBytes, data: new Uint8Array(0), offset });
    chunks.push(headerBytes);
    offset += headerBytes.length;
  }

  // Write file entries
  for (const [relativePath, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(relativePath);
    const dataBytes = encoder.encode(content);

    // CRC-32
    const crcValue = crc32(dataBytes);

    // Local file header
    const header = new ArrayBuffer(30 + nameBytes.length);
    const hView = new DataView(header);
    hView.setUint32(0, 0x04034b50, true);   // local file header signature
    hView.setUint16(4, 20, true);            // version needed (2.0)
    hView.setUint16(6, 0, true);             // general purpose bit flag
    hView.setUint16(8, 0, true);             // compression method: STORE
    hView.setUint16(10, 0, true);            // last mod file time
    hView.setUint16(12, 0, true);            // last mod file date
    hView.setUint32(14, crcValue, true);     // crc-32
    hView.setUint32(18, dataBytes.length, true); // compressed size
    hView.setUint32(22, dataBytes.length, true); // uncompressed size
    hView.setUint16(26, nameBytes.length, true); // file name length
    hView.setUint16(28, 0, true);            // extra field length
    new Uint8Array(header).set(nameBytes, 30);

    const headerBytes = new Uint8Array(header);
    entries.push({ name: nameBytes, data: dataBytes, offset });
    chunks.push(headerBytes, dataBytes);
    offset += headerBytes.length + dataBytes.length;
  }

  // Central directory
  const cdStart = offset;
  for (const entry of entries) {
    const isDir = entry.data.length === 0 && entry.name[entry.name.length - 1] === 0x2f;
    const cd = new ArrayBuffer(46 + entry.name.length);
    const cdView = new DataView(cd);
    cdView.setUint32(0, 0x02014b50, true);   // central directory signature
    cdView.setUint16(4, 20, true);            // version made by
    cdView.setUint16(6, 20, true);            // version needed
    cdView.setUint16(8, 0, true);             // flags
    cdView.setUint16(10, 0, true);            // compression: STORE
    cdView.setUint16(12, 0, true);            // mod time
    cdView.setUint16(14, 0, true);            // mod date

    if (!isDir) {
      const crcValue = crc32(entry.data);
      cdView.setUint32(16, crcValue, true);
      cdView.setUint32(20, entry.data.length, true);
      cdView.setUint32(24, entry.data.length, true);
    }

    cdView.setUint16(28, entry.name.length, true); // file name length
    cdView.setUint16(30, 0, true);            // extra field length
    cdView.setUint16(32, 0, true);            // file comment length
    cdView.setUint16(34, 0, true);            // disk number start
    cdView.setUint16(36, 0, true);            // internal file attributes
    cdView.setUint32(38, isDir ? 0x10 : 0, true); // external file attributes
    cdView.setUint32(42, entry.offset, true); // relative offset of local header
    new Uint8Array(cd).set(entry.name, 46);

    const cdBytes = new Uint8Array(cd);
    chunks.push(cdBytes);
    offset += cdBytes.length;
  }

  // End of central directory record
  const cdSize = offset - cdStart;
  const eocd = new ArrayBuffer(22);
  const eocdView = new DataView(eocd);
  eocdView.setUint32(0, 0x06054b50, true);   // EOCD signature
  eocdView.setUint16(4, 0, true);            // disk number
  eocdView.setUint16(6, 0, true);            // disk with central directory
  eocdView.setUint16(8, entries.length, true);  // entries on this disk
  eocdView.setUint16(10, entries.length, true); // total entries
  eocdView.setUint32(12, cdSize, true);       // size of central directory
  eocdView.setUint32(16, cdStart, true);      // offset of central directory
  eocdView.setUint16(20, 0, true);            // comment length
  chunks.push(new Uint8Array(eocd));

  // Concatenate all chunks
  const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

/**
 * Helper: create a zip file on disk from a map of { relativePath → content }.
 * Uses a pure-JS zip builder — no system `zip` binary required.
 * Returns the absolute path to the created .zip file.
 */
async function createTestZip(
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const zipPath = join(tempDir, `${name}.zip`);
  const zipData = buildZipBuffer(files);
  await Bun.write(zipPath, zipData);
  return zipPath;
}

/**
 * Helper: start a tiny HTTP server that serves a specific file.
 */
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
// Return shape
// ═════════════════════════════════════════════════════════════════════════════

describe("loadSkillsFromZip — return shape", () => {
  test("returns { skills, extractDir } object", async () => {
    const zipPath = await createTestZip("return-shape", {
      "SKILL.md": `---
name: shape-test
description: Test return shape.
---
`,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const result = await loadSkillsFromZip(sandbox, url);

      expect(result).toHaveProperty("skills");
      expect(result).toHaveProperty("extractDir");
      expect(Array.isArray(result.skills)).toBe(true);
      expect(typeof result.extractDir).toBe("string");
    } finally {
      stop();
    }
  });

  test("extractDir is a real directory on disk", async () => {
    const zipPath = await createTestZip("extract-dir-check", {
      "SKILL.md": `---
name: dir-check
description: Verify extract dir exists.
---
`,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { extractDir } = await loadSkillsFromZip(sandbox, url);

      // extractDir should exist and be readable
      const entries = await sandbox.readdir(extractDir, { withFileTypes: true });
      expect(entries.length).toBeGreaterThan(0);
    } finally {
      stop();
    }
  });

  test("__skill.zip is deleted after extraction", async () => {
    const zipPath = await createTestZip("zip-cleanup", {
      "SKILL.md": `---
name: cleanup-test
description: Verify zip file removed.
---
`,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { extractDir } = await loadSkillsFromZip(sandbox, url);

      // __skill.zip should have been deleted after extraction
      const zipFilePath = join(extractDir, "__skill.zip");
      await expect(access(zipFilePath)).rejects.toThrow();
    } finally {
      stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Case 1: Root-level SKILL.md (single skill)
// ═════════════════════════════════════════════════════════════════════════════

describe("loadSkillsFromZip — root-level SKILL.md", () => {
  test("discovers single skill when SKILL.md is at zip root", async () => {
    const zipPath = await createTestZip("root-single", {
      "SKILL.md": `---
name: root-skill
description: A root-level skill.
---

# Root Skill Instructions

Follow these steps.
`,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("root-skill");
      expect(skills[0].description).toBe("A root-level skill.");
      expect(skills[0].path).toBeDefined();
    } finally {
      stop();
    }
  });

  test("root SKILL.md wins — subdirectories are NOT scanned", async () => {
    const zipPath = await createTestZip("root-wins", {
      "SKILL.md": `---
name: root-skill
description: Root level skill.
---

# Root Instructions
`,
      "sub-skill/SKILL.md": `---
name: sub-skill
description: Should be ignored.
---

# Sub Instructions
`,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("root-skill");
    } finally {
      stop();
    }
  });

  test("root skill with references gets correct path", async () => {
    const zipPath = await createTestZip("root-with-refs", {
      "SKILL.md": `---
name: ref-skill
description: Skill with references.
---

# Instructions
`,
      "references/api-guide.md": "# API Guide\n\nSome docs.",
      "references/schema.json": '{"type": "object"}',
      "assets/template.yaml": "kind: template",
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills, extractDir } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("ref-skill");
      // For root-level skill, path = extractDir
      expect(skills[0].path).toBe(extractDir);
    } finally {
      stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Case 2: Subdirectory skills (one or more)
// ═════════════════════════════════════════════════════════════════════════════

describe("loadSkillsFromZip — subdirectory skills", () => {
  test("discovers single skill in subdirectory", async () => {
    const zipPath = await createTestZip("subdir-single", {
      "my-skill/SKILL.md": `---
name: my-skill
description: A subdirectory skill.
---

# My Skill
`,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("my-skill");
      expect(skills[0].description).toBe("A subdirectory skill.");
    } finally {
      stop();
    }
  });

  test("discovers multiple skills in subdirectories", async () => {
    const zipPath = await createTestZip("subdir-multi", {
      "skill-a/SKILL.md": `---
name: skill-a
description: First skill.
---

# Skill A
`,
      "skill-b/SKILL.md": `---
name: skill-b
description: Second skill.
---

# Skill B
`,
      "skill-c/SKILL.md": `---
name: skill-c
description: Third skill.
---

# Skill C
`,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(3);
      const names = skills.map((s) => s.name).sort();
      expect(names).toEqual(["skill-a", "skill-b", "skill-c"]);
    } finally {
      stop();
    }
  });

  test("skips subdirectories without SKILL.md", async () => {
    const zipPath = await createTestZip("subdir-skip-invalid", {
      "valid-skill/SKILL.md": `---
name: valid
description: Valid skill.
---

# Valid
`,
      "not-a-skill/readme.md": "# Just a readme",
      "also-not/data.json": "{}",
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("valid");
    } finally {
      stop();
    }
  });

  test("subdirectory skill paths point to subdirectories", async () => {
    const zipPath = await createTestZip("subdir-paths", {
      "my-skill/SKILL.md": `---
name: my-skill
description: Test paths.
---
`,
      "my-skill/references/doc.md": "# Doc",
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(1);
      expect(skills[0].path).toMatch(/my-skill$/);
    } finally {
      stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Error cases
// ═════════════════════════════════════════════════════════════════════════════

describe("loadSkillsFromZip — error handling", () => {
  test("throws when zip contains no skills", async () => {
    const zipPath = await createTestZip("empty-zip", {
      "readme.md": "# Just a readme, no SKILL.md anywhere",
      "data/config.json": "{}",
    });

    const { url, stop } = serveFile(zipPath);
    try {
      await expect(loadSkillsFromZip(sandbox, url)).rejects.toThrow(
        "No skills found in zip",
      );
    } finally {
      stop();
    }
  });

  test("throws when URL returns HTTP error", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("Not Found", { status: 404 });
      },
    });

    try {
      await expect(
        loadSkillsFromZip(sandbox, `http://localhost:${server.port}/bad.zip`),
      ).rejects.toThrow("Failed to download skill zip: HTTP 404");
    } finally {
      server.stop(true);
    }
  });

  test("throws when URL returns invalid zip content", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("this is not a zip file", {
          headers: { "Content-Type": "application/zip" },
        });
      },
    });

    try {
      await expect(
        loadSkillsFromZip(sandbox, `http://localhost:${server.port}/bad.zip`),
      ).rejects.toThrow("Failed to extract skill zip");
    } finally {
      server.stop(true);
    }
  });

  test("throws when root SKILL.md has invalid frontmatter", async () => {
    const zipPath = await createTestZip("bad-frontmatter-root", {
      "SKILL.md": "# No frontmatter at all!",
    });

    const { url, stop } = serveFile(zipPath);
    try {
      await expect(loadSkillsFromZip(sandbox, url)).rejects.toThrow();
    } finally {
      stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// End-to-end: zip skill → loadSkill tool with resources
// ═════════════════════════════════════════════════════════════════════════════

describe("loadSkillsFromZip — e2e with loadSkill tool", () => {
  test("zip-extracted skill is loadable via createLoadSkillTool with resources", async () => {
    const { createLoadSkillTool } = await import("../src/ai/skills/loader");

    const zipPath = await createTestZip("e2e-loadable", {
      "my-skill/SKILL.md": `---
name: e2e-zip-skill
description: E2E test skill from zip.
---

# E2E Zip Skill

These are the instructions for the E2E zip skill.
`,
      "my-skill/references/guide.md": "# Guide\n\nSome guide content.",
      "my-skill/assets/config.yaml": "key: value",
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);
      expect(skills).toHaveLength(1);

      // Now use the discovered skill with createLoadSkillTool
      const tool = createLoadSkillTool(sandbox, skills, []);
      const result = await tool.execute!(
        { name: "e2e-zip-skill" },
        { toolCallId: "test", messages: [] } as any,
      );

      // Verify content
      expect((result as any).content).toContain("# E2E Zip Skill");
      expect((result as any).content).toContain("These are the instructions");
      expect((result as any).content).not.toContain("---");

      // Verify skillDirectory
      expect((result as any).skillDirectory).toBeDefined();

      // Verify resources listing
      const resources: string[] = (result as any).resources;
      expect(resources).toContain("references/");
      expect(resources).toContain("references/guide.md");
      expect(resources).toContain("assets/");
      expect(resources).toContain("assets/config.yaml");
      expect(resources).not.toContain("SKILL.md");
    } finally {
      stop();
    }
  });
});
