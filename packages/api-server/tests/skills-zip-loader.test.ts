import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, realpath, access } from "fs/promises";
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

/**
 * Helper: create a directory structure and zip it.
 * Returns the absolute path to the created .zip file.
 */
async function createTestZip(
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const sourceDir = join(tempDir, `${name}-src`);
  const zipPath = join(tempDir, `${name}.zip`);

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(sourceDir, relativePath);
    const dir = fullPath.slice(0, fullPath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content);
  }

  const proc = Bun.spawn(
    ["sh", "-c", `cd "${sourceDir}" && zip -r "${zipPath}" .`],
    { stdout: "pipe", stderr: "pipe" },
  );
  await proc.exited;

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
