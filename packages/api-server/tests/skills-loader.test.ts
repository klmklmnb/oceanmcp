import { describe, test, expect } from "bun:test";
import { buildSkillsPrompt, createLoadSkillTool } from "../src/ai/skills/loader";
import type { DiscoveredSkill } from "../src/ai/skills/discover";
import type { Sandbox } from "@ocean-mcp/shared";

// ─────────────────────────────────────────────────────────────────────────────
// Mock Sandbox Helper (simplified for loader tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a mock Sandbox backed by a simple file map.
 * Only readFile is needed for loader tests (the loadSkill tool reads SKILL.md).
 */
function createMockSandbox(files: Record<string, string>): Sandbox {
  return {
    async readFile(path: string) {
      if (!(path in files)) {
        throw new Error(`ENOENT: no such file: ${path}`);
      }
      return files[path];
    },
    async readdir() {
      throw new Error("readdir not needed in loader tests");
    },
    async exec() {
      throw new Error("exec not needed in loader tests");
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// buildSkillsPrompt
// ═════════════════════════════════════════════════════════════════════════════

describe("buildSkillsPrompt", () => {
  test("returns empty string when no skills are provided", () => {
    const result = buildSkillsPrompt([]);
    expect(result).toBe("");
  });

  test("includes skill name and description for a single skill", () => {
    const skills: DiscoveredSkill[] = [
      {
        name: "pdf-processing",
        description: "Extract text from PDF files.",
        path: "/skills/pdf-processing",
      },
    ];
    const result = buildSkillsPrompt(skills);
    expect(result).toContain("**pdf-processing**");
    expect(result).toContain("Extract text from PDF files.");
  });

  test("includes all skills in the catalog list", () => {
    const skills: DiscoveredSkill[] = [
      {
        name: "skill-a",
        description: "First skill.",
        path: "/skills/skill-a",
      },
      {
        name: "skill-b",
        description: "Second skill.",
        path: "/skills/skill-b",
      },
      {
        name: "skill-c",
        description: "Third skill.",
        path: "/skills/skill-c",
      },
    ];
    const result = buildSkillsPrompt(skills);
    expect(result).toContain("**skill-a**");
    expect(result).toContain("**skill-b**");
    expect(result).toContain("**skill-c**");
    expect(result).toContain("First skill.");
    expect(result).toContain("Second skill.");
    expect(result).toContain("Third skill.");
  });

  test("includes loadSkill usage instruction", () => {
    const skills: DiscoveredSkill[] = [
      {
        name: "test",
        description: "Test skill.",
        path: "/skills/test",
      },
    ];
    const result = buildSkillsPrompt(skills);
    expect(result).toContain("`loadSkill`");
  });

  test("includes Available Skills header", () => {
    const skills: DiscoveredSkill[] = [
      {
        name: "test",
        description: "Test skill.",
        path: "/skills/test",
      },
    ];
    const result = buildSkillsPrompt(skills);
    expect(result).toContain("# Available Skills");
  });

  test("does not include paths in the output (implementation detail)", () => {
    const skills: DiscoveredSkill[] = [
      {
        name: "test",
        description: "Test skill.",
        path: "/some/internal/path/skills/test",
      },
    ];
    const result = buildSkillsPrompt(skills);
    // The prompt should not leak internal file paths — only name + description
    expect(result).not.toContain("/some/internal/path");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createLoadSkillTool
// ═════════════════════════════════════════════════════════════════════════════

describe("createLoadSkillTool", () => {
  const validSkillContent = `---
name: my-skill
description: Does something.
---

# My Skill Instructions

## Step 1
Do this first.

## Step 2
Then do this.
`;

  const skills: DiscoveredSkill[] = [
    {
      name: "my-skill",
      description: "Does something.",
      path: "/skills/my-skill",
    },
    {
      name: "other-skill",
      description: "Does other things.",
      path: "/skills/other-skill",
    },
  ];

  test("loads existing skill and returns body without frontmatter", async () => {
    const sandbox = createMockSandbox({
      "/skills/my-skill/SKILL.md": validSkillContent,
    });
    const tool = createLoadSkillTool(sandbox, skills, []);
    const result = await tool.execute!({ name: "my-skill" }, {
      toolCallId: "test",
      messages: [],
    } as any);

    expect(result).toHaveProperty("content");
    expect((result as any).content).toContain("# My Skill Instructions");
    expect((result as any).content).toContain("## Step 1");
    expect((result as any).content).toContain("## Step 2");
    // Should NOT contain frontmatter
    expect((result as any).content).not.toContain("---");
    expect((result as any).content).not.toContain("name: my-skill");
  });

  test("returns skillDirectory path alongside content", async () => {
    const sandbox = createMockSandbox({
      "/skills/my-skill/SKILL.md": validSkillContent,
    });
    const tool = createLoadSkillTool(sandbox, skills, []);
    const result = await tool.execute!({ name: "my-skill" }, {
      toolCallId: "test",
      messages: [],
    } as any);

    expect((result as any).skillDirectory).toBe("/skills/my-skill");
  });

  test("performs case-insensitive name matching", async () => {
    const sandbox = createMockSandbox({
      "/skills/my-skill/SKILL.md": validSkillContent,
    });
    const tool = createLoadSkillTool(sandbox, skills, []);

    // Uppercase
    const result1 = await tool.execute!({ name: "MY-SKILL" }, {
      toolCallId: "test",
      messages: [],
    } as any);
    expect((result1 as any).content).toContain("# My Skill Instructions");

    // Mixed case
    const result2 = await tool.execute!({ name: "My-Skill" }, {
      toolCallId: "test",
      messages: [],
    } as any);
    expect((result2 as any).content).toContain("# My Skill Instructions");
  });

  test("returns error for unknown skill name", async () => {
    const sandbox = createMockSandbox({});
    const tool = createLoadSkillTool(sandbox, skills, []);
    const result = await tool.execute!({ name: "nonexistent" }, {
      toolCallId: "test",
      messages: [],
    } as any);

    expect(result).toHaveProperty("error");
    expect((result as any).error).toContain("Skill 'nonexistent' not found");
  });

  test("error message lists available skill names", async () => {
    const sandbox = createMockSandbox({});
    const tool = createLoadSkillTool(sandbox, skills, []);
    const result = await tool.execute!({ name: "bad-name" }, {
      toolCallId: "test",
      messages: [],
    } as any);

    expect((result as any).error).toContain("my-skill");
    expect((result as any).error).toContain("other-skill");
  });

  test("error message handles empty skills list", async () => {
    const sandbox = createMockSandbox({});
    const tool = createLoadSkillTool(sandbox, [], []);
    const result = await tool.execute!({ name: "anything" }, {
      toolCallId: "test",
      messages: [],
    } as any);

    expect((result as any).error).toContain("not found");
    expect((result as any).error).toContain("none");
  });

  test("handles sandbox read failure gracefully", async () => {
    // Sandbox that throws on readFile
    const failingSandbox: Sandbox = {
      async readFile() {
        throw new Error("Disk I/O error");
      },
      async readdir() {
        throw new Error("not needed");
      },
      async exec() {
        throw new Error("not needed");
      },
    };
    const tool = createLoadSkillTool(failingSandbox, skills, []);
    const result = await tool.execute!({ name: "my-skill" }, {
      toolCallId: "test",
      messages: [],
    } as any);

    expect(result).toHaveProperty("error");
    expect((result as any).error).toContain("Failed to load skill");
    expect((result as any).error).toContain("Disk I/O error");
  });

  test("loads skill with minimal content (just frontmatter, no body)", async () => {
    const sandbox = createMockSandbox({
      "/skills/my-skill/SKILL.md": `---
name: my-skill
description: Does something.
---
`,
    });
    const tool = createLoadSkillTool(sandbox, skills, []);
    const result = await tool.execute!({ name: "my-skill" }, {
      toolCallId: "test",
      messages: [],
    } as any);

    expect((result as any).content).toBe("");
    expect((result as any).skillDirectory).toBe("/skills/my-skill");
  });

  test("tool has correct description", () => {
    const sandbox = createMockSandbox({});
    const tool = createLoadSkillTool(sandbox, skills, []);
    expect(tool.description).toContain("Load a skill");
  });

  test("tool has name in input schema", () => {
    const sandbox = createMockSandbox({});
    const tool = createLoadSkillTool(sandbox, skills, []);
    // The tool should accept a 'name' parameter
    expect(tool.inputSchema).toBeDefined();
  });
});
