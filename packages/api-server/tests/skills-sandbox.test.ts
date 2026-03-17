import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createNodeSandbox } from "../src/ai/skills/sandbox";

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests for createNodeSandbox
//
// These tests use a real temporary directory on disk to verify that the
// NodeSandbox implementation correctly delegates to the local filesystem
// and Bun.spawn. The temp directory is created in beforeAll and cleaned
// up in afterAll.
//
// These tests validate the "real" sandbox used in production, complementing
// the mock sandbox used in the discover/loader unit tests.
//
// Note: On macOS, /var is a symlink to /private/var. We use `realpath()`
// to resolve the canonical path so assertions match `pwd` output.
// ─────────────────────────────────────────────────────────────────────────────

let tempDir: string;
let sandbox: ReturnType<typeof createNodeSandbox>;

beforeAll(async () => {
  const rawTemp = await mkdtemp(join(tmpdir(), "ocean-mcp-sandbox-test-"));
  // Resolve symlinks (e.g. macOS /var → /private/var) so that assertions
  // comparing against `pwd` output work correctly.
  tempDir = await realpath(rawTemp);
  sandbox = createNodeSandbox(tempDir);

  // Set up test file structure:
  //   tempDir/
  //   ├── test-file.txt        ("hello world")
  //   ├── sub-dir/
  //   │   └── nested-file.txt  ("nested content")
  //   └── empty-dir/
  await writeFile(join(tempDir, "test-file.txt"), "hello world");
  await mkdir(join(tempDir, "sub-dir"));
  await writeFile(join(tempDir, "sub-dir", "nested-file.txt"), "nested content");
  await mkdir(join(tempDir, "empty-dir"));
});

afterAll(async () => {
  // Clean up temp directory
  await rm(tempDir, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// readFile
// ═════════════════════════════════════════════════════════════════════════════

describe("NodeSandbox.readFile", () => {
  test("reads an existing file", async () => {
    const content = await sandbox.readFile(
      join(tempDir, "test-file.txt"),
      "utf-8",
    );
    expect(content).toBe("hello world");
  });

  test("reads a file in a subdirectory", async () => {
    const content = await sandbox.readFile(
      join(tempDir, "sub-dir", "nested-file.txt"),
      "utf-8",
    );
    expect(content).toBe("nested content");
  });

  test("throws for non-existent file", async () => {
    await expect(
      sandbox.readFile(join(tempDir, "does-not-exist.txt"), "utf-8"),
    ).rejects.toThrow();
  });

  test("throws for directory path", async () => {
    // Reading a directory as a file should fail
    await expect(
      sandbox.readFile(join(tempDir, "sub-dir"), "utf-8"),
    ).rejects.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// readdir
// ═════════════════════════════════════════════════════════════════════════════

describe("NodeSandbox.readdir", () => {
  test("lists entries in a directory", async () => {
    const entries = await sandbox.readdir(tempDir, { withFileTypes: true });
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain("test-file.txt");
    expect(names).toContain("sub-dir");
    expect(names).toContain("empty-dir");
  });

  test("entries have correct isDirectory() for files", async () => {
    const entries = await sandbox.readdir(tempDir, { withFileTypes: true });
    const fileEntry = entries.find((e) => e.name === "test-file.txt");
    expect(fileEntry).toBeDefined();
    expect(fileEntry!.isDirectory()).toBe(false);
  });

  test("entries have correct isDirectory() for directories", async () => {
    const entries = await sandbox.readdir(tempDir, { withFileTypes: true });
    const dirEntry = entries.find((e) => e.name === "sub-dir");
    expect(dirEntry).toBeDefined();
    expect(dirEntry!.isDirectory()).toBe(true);
  });

  test("lists entries in a subdirectory", async () => {
    const entries = await sandbox.readdir(join(tempDir, "sub-dir"), {
      withFileTypes: true,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("nested-file.txt");
    expect(entries[0].isDirectory()).toBe(false);
  });

  test("returns empty array for empty directory", async () => {
    const entries = await sandbox.readdir(join(tempDir, "empty-dir"), {
      withFileTypes: true,
    });
    expect(entries).toHaveLength(0);
  });

  test("throws for non-existent directory", async () => {
    await expect(
      sandbox.readdir(join(tempDir, "nonexistent"), { withFileTypes: true }),
    ).rejects.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// exec
// ═════════════════════════════════════════════════════════════════════════════

describe("NodeSandbox.exec", () => {
  test("runs a simple command and captures stdout", async () => {
    const result = await sandbox.exec("echo hello");
    expect(result.stdout.trim()).toBe("hello");
  });

  test("captures stderr output", async () => {
    const result = await sandbox.exec("echo error-msg >&2");
    expect(result.stderr.trim()).toBe("error-msg");
  });

  test("uses default working directory", async () => {
    const result = await sandbox.exec("pwd");
    expect(result.stdout.trim()).toBe(tempDir);
  });

  test("respects cwd option override", async () => {
    const subDir = join(tempDir, "sub-dir");
    const result = await sandbox.exec("pwd", { cwd: subDir });
    expect(result.stdout.trim()).toBe(subDir);
  });

  test("handles commands with pipes", async () => {
    const result = await sandbox.exec("echo 'hello world' | tr ' ' '-'");
    expect(result.stdout.trim()).toBe("hello-world");
  });

  test("returns empty stderr on successful command", async () => {
    const result = await sandbox.exec("echo ok");
    expect(result.stderr).toBe("");
  });

  test("can list files in the working directory", async () => {
    const result = await sandbox.exec("ls");
    expect(result.stdout).toContain("test-file.txt");
    expect(result.stdout).toContain("sub-dir");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// End-to-end: sandbox with discoverSkills
// ═════════════════════════════════════════════════════════════════════════════

describe("NodeSandbox end-to-end with skill discovery", () => {
  let skillDir: string;

  beforeAll(async () => {
    // Set up a real skill directory structure:
    //   tempDir/skills/
    //   └── e2e-skill/
    //       └── SKILL.md
    skillDir = join(tempDir, "skills");
    await mkdir(join(skillDir, "e2e-skill"), { recursive: true });
    await writeFile(
      join(skillDir, "e2e-skill", "SKILL.md"),
      `---
name: e2e-skill
description: End-to-end test skill.
---

# E2E Skill

These are the instructions.
`,
    );
  });

  test("discoverSkills finds skills using NodeSandbox", async () => {
    // Import here to avoid module-level side effects
    const { discoverSkills } = await import("../src/ai/skills/discover");

    const skills = await discoverSkills(sandbox, [skillDir]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("e2e-skill");
    expect(skills[0].description).toBe("End-to-end test skill.");
    expect(skills[0].path).toBe(join(skillDir, "e2e-skill"));
  });

  test("loadSkill reads full content using NodeSandbox", async () => {
    const { discoverSkills } = await import("../src/ai/skills/discover");
    const { createLoadSkillTool } = await import("../src/ai/skills/loader");

    const skills = await discoverSkills(sandbox, [skillDir]);
    const tool = createLoadSkillTool(sandbox, skills, []);
    const result = await tool.execute!({ name: "e2e-skill" }, {
      toolCallId: "test",
      messages: [],
    } as any);

    expect((result as any).content).toContain("# E2E Skill");
    expect((result as any).content).toContain("These are the instructions.");
    expect((result as any).content).not.toContain("---");
    expect((result as any).skillDirectory).toBe(join(skillDir, "e2e-skill"));
  });

  test("loadSkill returns empty resources for skill without reference files", async () => {
    const { discoverSkills } = await import("../src/ai/skills/discover");
    const { createLoadSkillTool } = await import("../src/ai/skills/loader");

    const skills = await discoverSkills(sandbox, [skillDir]);
    const tool = createLoadSkillTool(sandbox, skills, []);
    const result = await tool.execute!({ name: "e2e-skill" }, {
      toolCallId: "test",
      messages: [],
    } as any);

    expect((result as any).resources).toBeDefined();
    expect(Array.isArray((result as any).resources)).toBe(true);
    // e2e-skill only has SKILL.md, which is excluded from resources
    expect((result as any).resources).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// End-to-end: NodeSandbox with skill resources
// ═════════════════════════════════════════════════════════════════════════════

describe("NodeSandbox end-to-end with skill resources", () => {
  let skillDir: string;

  beforeAll(async () => {
    // Set up a real skill directory with resource files:
    //   tempDir/skills-with-refs/
    //   └── rich-skill/
    //       ├── SKILL.md
    //       ├── references/
    //       │   ├── api-guide.md
    //       │   └── schema.json
    //       ├── scripts/
    //       │   └── deploy.sh
    //       └── assets/
    //           └── config.yaml
    skillDir = join(tempDir, "skills-with-refs");
    const skillRoot = join(skillDir, "rich-skill");

    await mkdir(join(skillRoot, "references"), { recursive: true });
    await mkdir(join(skillRoot, "scripts"), { recursive: true });
    await mkdir(join(skillRoot, "assets"), { recursive: true });

    await writeFile(
      join(skillRoot, "SKILL.md"),
      `---
name: rich-skill
description: A skill with bundled resources.
---

# Rich Skill

Use the resources in references/ and scripts/ to complete tasks.
`,
    );
    await writeFile(
      join(skillRoot, "references", "api-guide.md"),
      "# API Guide\n\nEndpoints and usage.",
    );
    await writeFile(
      join(skillRoot, "references", "schema.json"),
      '{"type": "object", "properties": {}}',
    );
    await writeFile(
      join(skillRoot, "scripts", "deploy.sh"),
      "#!/bin/bash\necho deploying",
    );
    await writeFile(
      join(skillRoot, "assets", "config.yaml"),
      "key: value\nenv: prod",
    );
  });

  test("loadSkill returns resource listing for skill with reference files", async () => {
    const { discoverSkills } = await import("../src/ai/skills/discover");
    const { createLoadSkillTool } = await import("../src/ai/skills/loader");

    const skills = await discoverSkills(sandbox, [skillDir]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("rich-skill");

    const tool = createLoadSkillTool(sandbox, skills, []);
    const result = await tool.execute!({ name: "rich-skill" }, {
      toolCallId: "test",
      messages: [],
    } as any);

    const resources: string[] = (result as any).resources;
    expect(resources).toBeDefined();

    // Directories should be listed with trailing /
    expect(resources).toContain("references/");
    expect(resources).toContain("scripts/");
    expect(resources).toContain("assets/");

    // Files should be listed with their relative paths
    expect(resources).toContain("references/api-guide.md");
    expect(resources).toContain("references/schema.json");
    expect(resources).toContain("scripts/deploy.sh");
    expect(resources).toContain("assets/config.yaml");

    // SKILL.md itself should NOT be in resources
    expect(resources).not.toContain("SKILL.md");
  });

  test("resource files are actually readable via sandbox using skillDirectory + resource path", async () => {
    const { discoverSkills } = await import("../src/ai/skills/discover");
    const { createLoadSkillTool } = await import("../src/ai/skills/loader");

    const skills = await discoverSkills(sandbox, [skillDir]);
    const tool = createLoadSkillTool(sandbox, skills, []);
    const result = await tool.execute!({ name: "rich-skill" }, {
      toolCallId: "test",
      messages: [],
    } as any);

    const skillDirectory: string = (result as any).skillDirectory;
    const resources: string[] = (result as any).resources;

    // Pick a resource file and verify it can be read
    expect(resources).toContain("references/api-guide.md");
    const content = await sandbox.readFile(
      `${skillDirectory}/references/api-guide.md`,
      "utf-8",
    );
    expect(content).toContain("# API Guide");
    expect(content).toContain("Endpoints and usage.");
  });
});
