import { describe, test, expect } from "bun:test";
import {
  parseFrontmatter,
  stripFrontmatter,
  discoverSkills,
} from "../src/ai/skills/discover";
import type { Sandbox, SandboxDirEntry } from "oceanmcp-shared";

// ─────────────────────────────────────────────────────────────────────────────
// Mock Sandbox Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an in-memory mock Sandbox for testing.
 *
 * Accepts a flat record of file paths → contents. Directory structure is
 * inferred from the file paths. This lets tests set up arbitrary skill
 * directory layouts without touching the real filesystem.
 *
 * This is the primary benefit of the Sandbox abstraction for testability —
 * the same mock pattern can be used for unit tests of any code that depends
 * on the Sandbox interface.
 *
 * @param files - Map of absolute paths to file contents
 * @returns A Sandbox implementation backed by in-memory data
 */
function createMockSandbox(files: Record<string, string>): Sandbox {
  return {
    async readFile(path: string) {
      if (!(path in files)) {
        throw new Error(`ENOENT: no such file: ${path}`);
      }
      return files[path];
    },

    async readdir(path: string) {
      const prefix = path.endsWith("/") ? path : path + "/";
      const entries = new Map<string, boolean>();

      for (const filePath of Object.keys(files)) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        const segment = rest.split("/")[0];
        if (!segment) continue;

        // If there are more segments after this one, it's a directory
        const isDir = rest.includes("/");
        // Once marked as a dir, keep it as dir
        if (!entries.has(segment) || isDir) {
          entries.set(segment, isDir);
        }
      }

      if (entries.size === 0 && !Object.keys(files).some((f) => f.startsWith(prefix))) {
        throw new Error(`ENOENT: no such directory: ${path}`);
      }

      return Array.from(entries.entries()).map(
        ([name, isDir]): SandboxDirEntry => ({
          name,
          isDirectory: () => isDir,
        }),
      );
    },

    async exec() {
      throw new Error("exec not supported in mock sandbox");
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// parseFrontmatter
// ═════════════════════════════════════════════════════════════════════════════

describe("parseFrontmatter", () => {
  test("parses valid frontmatter with name and description", () => {
    const content = `---
name: my-skill
description: Does something useful.
---

# Instructions
`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: "my-skill",
      description: "Does something useful.",
    });
  });

  test("parses frontmatter with extra fields (ignores them)", () => {
    const content = `---
name: pdf-processing
description: Process PDF files.
version: 1.0.0
author: test
---

Body text.
`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: "pdf-processing",
      description: "Process PDF files.",
    });
  });

  test("handles frontmatter with leading/trailing whitespace in values", () => {
    const content = `---
name:   spaced-skill  
description:   A skill with spaces.  
---
`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: "spaced-skill",
      description: "A skill with spaces.",
    });
  });

  test("handles description containing a colon", () => {
    const content = `---
name: colon-skill
description: Does this: processes things.
---
`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: "colon-skill",
      description: "Does this: processes things.",
    });
  });

  test("handles Windows line endings (\\r\\n)", () => {
    const content = "---\r\nname: win-skill\r\ndescription: Windows style.\r\n---\r\n\r\nBody.";
    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: "win-skill",
      description: "Windows style.",
    });
  });

  test("throws when no frontmatter block is present", () => {
    const content = "# Just a markdown file\n\nNo frontmatter here.";
    expect(() => parseFrontmatter(content)).toThrow(
      "No frontmatter found in SKILL.md",
    );
  });

  test("throws when frontmatter is missing opening delimiter", () => {
    const content = "name: my-skill\ndescription: No delimiters.\n---";
    expect(() => parseFrontmatter(content)).toThrow(
      "No frontmatter found in SKILL.md",
    );
  });

  test("throws when name field is missing", () => {
    const content = `---
description: Has description but no name.
---
`;
    expect(() => parseFrontmatter(content)).toThrow(
      'SKILL.md frontmatter missing required "name" field',
    );
  });

  test("throws when description field is missing", () => {
    const content = `---
name: no-desc-skill
---
`;
    expect(() => parseFrontmatter(content)).toThrow(
      'SKILL.md frontmatter missing required "description" field',
    );
  });

  test("throws when frontmatter is empty", () => {
    // An empty frontmatter block (--- immediately followed by ---) does not
    // match the regex pattern which requires at least one character between
    // delimiters, so it throws "No frontmatter found".
    const content = `---
---

Body.
`;
    expect(() => parseFrontmatter(content)).toThrow(
      "No frontmatter found in SKILL.md",
    );
  });

  test("throws when name value is empty string", () => {
    const content = `---
name:
description: Has description.
---
`;
    expect(() => parseFrontmatter(content)).toThrow(
      'SKILL.md frontmatter missing required "name" field',
    );
  });

  test("throws when description value is empty string", () => {
    const content = `---
name: empty-desc
description:
---
`;
    expect(() => parseFrontmatter(content)).toThrow(
      'SKILL.md frontmatter missing required "description" field',
    );
  });

  test("ignores lines without colons", () => {
    const content = `---
name: my-skill
this line has no colon
description: Valid description.
---
`;
    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: "my-skill",
      description: "Valid description.",
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// stripFrontmatter
// ═════════════════════════════════════════════════════════════════════════════

describe("stripFrontmatter", () => {
  test("strips frontmatter and returns body", () => {
    const content = `---
name: my-skill
description: Test.
---

# Instructions

Do something.
`;
    const result = stripFrontmatter(content);
    expect(result).toBe("# Instructions\n\nDo something.");
  });

  test("returns full content when no frontmatter present", () => {
    const content = "# Just markdown\n\nNo frontmatter.";
    const result = stripFrontmatter(content);
    expect(result).toBe("# Just markdown\n\nNo frontmatter.");
  });

  test("trims leading whitespace after frontmatter", () => {
    const content = `---
name: test
description: Test.
---


   
# Body starts here.
`;
    const result = stripFrontmatter(content);
    expect(result).toBe("# Body starts here.");
  });

  test("handles Windows line endings (\\r\\n)", () => {
    const content = "---\r\nname: test\r\ndescription: Test.\r\n---\r\n\r\n# Body.";
    const result = stripFrontmatter(content);
    expect(result).toBe("# Body.");
  });

  test("handles frontmatter with no body after it", () => {
    const content = `---
name: empty-body
description: No body.
---
`;
    const result = stripFrontmatter(content);
    expect(result).toBe("");
  });

  test("preserves body formatting and whitespace within content", () => {
    const content = `---
name: test
description: Test.
---

# Title

  indented line

    code block

- list item
`;
    const result = stripFrontmatter(content);
    expect(result).toContain("  indented line");
    expect(result).toContain("    code block");
    expect(result).toContain("- list item");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// discoverSkills
// ═════════════════════════════════════════════════════════════════════════════

describe("discoverSkills", () => {
  test("discovers a single valid skill", async () => {
    const sandbox = createMockSandbox({
      "/skills/my-skill/SKILL.md": `---
name: my-skill
description: Does something.
---

# Instructions
`,
    });

    const skills = await discoverSkills(sandbox, ["/skills"]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("my-skill");
    expect(skills[0].description).toBe("Does something.");
    expect(skills[0].path).toBe("/skills/my-skill");
  });

  test("discovers multiple skills from one directory", async () => {
    const sandbox = createMockSandbox({
      "/skills/skill-a/SKILL.md": `---
name: skill-a
description: First skill.
---
Body A.
`,
      "/skills/skill-b/SKILL.md": `---
name: skill-b
description: Second skill.
---
Body B.
`,
    });

    const skills = await discoverSkills(sandbox, ["/skills"]);
    expect(skills).toHaveLength(2);

    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["skill-a", "skill-b"]);
  });

  test("skips non-directory entries in the skills directory", async () => {
    const sandbox = createMockSandbox({
      "/skills/valid-skill/SKILL.md": `---
name: valid
description: Valid.
---
`,
      // This is a file, not a directory — should be skipped
      "/skills/readme.md": "# Not a skill",
    });

    const skills = await discoverSkills(sandbox, ["/skills"]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("valid");
  });

  test("skips directories without SKILL.md", async () => {
    const sandbox = createMockSandbox({
      "/skills/has-skill/SKILL.md": `---
name: has-skill
description: Valid.
---
`,
      // This directory has no SKILL.md, just other files
      "/skills/no-skill/readme.md": "# Not a skill file",
    });

    const skills = await discoverSkills(sandbox, ["/skills"]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("has-skill");
  });

  test("skips directories with invalid frontmatter", async () => {
    const sandbox = createMockSandbox({
      "/skills/valid/SKILL.md": `---
name: valid
description: Valid skill.
---
`,
      "/skills/invalid/SKILL.md": `# No frontmatter at all!`,
    });

    const skills = await discoverSkills(sandbox, ["/skills"]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("valid");
  });

  test("first-name-wins deduplication across directories", async () => {
    const sandbox = createMockSandbox({
      "/project-skills/my-skill/SKILL.md": `---
name: my-skill
description: Project version (should win).
---
`,
      "/global-skills/my-skill/SKILL.md": `---
name: my-skill
description: Global version (should be skipped).
---
`,
    });

    // Project skills are listed first, so they take priority
    const skills = await discoverSkills(sandbox, [
      "/project-skills",
      "/global-skills",
    ]);
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe("Project version (should win).");
    expect(skills[0].path).toBe("/project-skills/my-skill");
  });

  test("first-name-wins deduplication within same directory", async () => {
    // Two different directory names but same skill name in frontmatter
    const sandbox = createMockSandbox({
      "/skills/dir-a/SKILL.md": `---
name: same-name
description: From dir-a.
---
`,
      "/skills/dir-b/SKILL.md": `---
name: same-name
description: From dir-b (should be skipped).
---
`,
    });

    const skills = await discoverSkills(sandbox, ["/skills"]);
    expect(skills).toHaveLength(1);
    // The exact winner depends on readdir order, but only one should survive
    expect(skills[0].name).toBe("same-name");
  });

  test("scans multiple directories in order", async () => {
    const sandbox = createMockSandbox({
      "/dir-a/skill-1/SKILL.md": `---
name: skill-1
description: From dir-a.
---
`,
      "/dir-b/skill-2/SKILL.md": `---
name: skill-2
description: From dir-b.
---
`,
    });

    const skills = await discoverSkills(sandbox, ["/dir-a", "/dir-b"]);
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["skill-1", "skill-2"]);
  });

  test("skips non-existent directories gracefully", async () => {
    const sandbox = createMockSandbox({
      "/existing/my-skill/SKILL.md": `---
name: my-skill
description: Valid.
---
`,
    });

    // /nonexistent does not exist — should be skipped without error
    const skills = await discoverSkills(sandbox, [
      "/nonexistent",
      "/existing",
    ]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("my-skill");
  });

  test("returns empty array when no skills found", async () => {
    const sandbox = createMockSandbox({});
    const skills = await discoverSkills(sandbox, ["/empty"]);
    expect(skills).toHaveLength(0);
  });

  test("returns empty array when all directories are non-existent", async () => {
    const sandbox = createMockSandbox({});
    const skills = await discoverSkills(sandbox, [
      "/nope1",
      "/nope2",
      "/nope3",
    ]);
    expect(skills).toHaveLength(0);
  });

  test("populates path correctly with the skill directory", async () => {
    const sandbox = createMockSandbox({
      "/skills/pdf-processing/SKILL.md": `---
name: pdf-processing
description: Process PDFs.
---
`,
    });

    const skills = await discoverSkills(sandbox, ["/skills"]);
    expect(skills[0].path).toBe("/skills/pdf-processing");
  });

  test("skills have no tools property when tools.ts is not present", async () => {
    const sandbox = createMockSandbox({
      "/skills/simple/SKILL.md": `---
name: simple
description: A simple skill.
---
`,
    });

    const skills = await discoverSkills(sandbox, ["/skills"]);
    expect(skills[0].tools).toBeUndefined();
  });

  test("handles empty directories array", async () => {
    const sandbox = createMockSandbox({
      "/skills/my-skill/SKILL.md": `---
name: my-skill
description: Valid.
---
`,
    });

    const skills = await discoverSkills(sandbox, []);
    expect(skills).toHaveLength(0);
  });

  test("handles skill with missing description in frontmatter", async () => {
    const sandbox = createMockSandbox({
      "/skills/bad/SKILL.md": `---
name: bad-skill
---
`,
      "/skills/good/SKILL.md": `---
name: good-skill
description: Valid.
---
`,
    });

    // bad-skill should be skipped, good-skill should be discovered
    const skills = await discoverSkills(sandbox, ["/skills"]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("good-skill");
  });

  test("handles skill with missing name in frontmatter", async () => {
    const sandbox = createMockSandbox({
      "/skills/no-name/SKILL.md": `---
description: No name field.
---
`,
      "/skills/named/SKILL.md": `---
name: named
description: Has a name.
---
`,
    });

    const skills = await discoverSkills(sandbox, ["/skills"]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("named");
  });
});
