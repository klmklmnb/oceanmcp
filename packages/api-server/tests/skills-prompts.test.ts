import { describe, test, expect, beforeEach } from "bun:test";
import {
  initSkills,
  addDiscoveredSkills,
  getSystemPrompt,
  getSkillsContext,
} from "../src/ai/prompts";
import type { DiscoveredSkill } from "../src/ai/skills/discover";

// ─────────────────────────────────────────────────────────────────────────────
// Tests for addDiscoveredSkills and its integration with getSystemPrompt
//
// These tests verify that dynamically added skills (from zip files or other
// runtime sources) are correctly:
//   1. Deduplicated against existing skills
//   2. Visible in getSystemPrompt() output
//   3. Accessible via getSkillsContext()
//
// Note: initSkills() is called at server startup and scans configured
// directories. We call it in beforeEach to reset to a known state, but the
// existing example skill may or may not be present depending on the test env.
// Tests are designed to work regardless of what initSkills finds.
// ─────────────────────────────────────────────────────────────────────────────

describe("addDiscoveredSkills", () => {
  beforeEach(async () => {
    // Re-initialize to reset discoveredSkills to the startup baseline
    await initSkills();
  });

  test("adds a new skill to the discovered skills", () => {
    const newSkill: DiscoveredSkill = {
      name: "zip-test-skill",
      description: "A skill added from a zip file.",
      path: "/tmp/ocean-mcp-skills/test-uuid/zip-test-skill",
    };

    const added = addDiscoveredSkills([newSkill]);
    expect(added).toHaveLength(1);
    expect(added[0].name).toBe("zip-test-skill");

    // Should now be in the skills context
    const { skills } = getSkillsContext();
    const found = skills.find((s) => s.name === "zip-test-skill");
    expect(found).toBeDefined();
    expect(found!.description).toBe("A skill added from a zip file.");
  });

  test("adds multiple skills at once", () => {
    const newSkills: DiscoveredSkill[] = [
      {
        name: "zip-skill-a",
        description: "First zip skill.",
        path: "/tmp/a",
      },
      {
        name: "zip-skill-b",
        description: "Second zip skill.",
        path: "/tmp/b",
      },
    ];

    const added = addDiscoveredSkills(newSkills);
    expect(added).toHaveLength(2);

    const { skills } = getSkillsContext();
    const names = skills.map((s) => s.name);
    expect(names).toContain("zip-skill-a");
    expect(names).toContain("zip-skill-b");
  });

  test("deduplicates against existing skills (case-insensitive)", () => {
    // First add a skill
    addDiscoveredSkills([
      {
        name: "Unique-Skill",
        description: "First version.",
        path: "/tmp/first",
      },
    ]);

    // Try to add a skill with the same name (different case)
    const added = addDiscoveredSkills([
      {
        name: "unique-skill",
        description: "Duplicate, should be skipped.",
        path: "/tmp/second",
      },
    ]);

    expect(added).toHaveLength(0);

    // Original version should still be there
    const { skills } = getSkillsContext();
    const found = skills.find(
      (s) => s.name.toLowerCase() === "unique-skill",
    );
    expect(found!.description).toBe("First version.");
  });

  test("deduplicates within the same batch", () => {
    const newSkills: DiscoveredSkill[] = [
      {
        name: "dup-skill",
        description: "First one wins.",
        path: "/tmp/a",
      },
      {
        name: "dup-skill",
        description: "Should be skipped.",
        path: "/tmp/b",
      },
    ];

    const added = addDiscoveredSkills(newSkills);
    expect(added).toHaveLength(1);
    expect(added[0].description).toBe("First one wins.");
  });

  test("returns empty array when all skills are duplicates", () => {
    addDiscoveredSkills([
      {
        name: "existing-skill",
        description: "Already here.",
        path: "/tmp/existing",
      },
    ]);

    const added = addDiscoveredSkills([
      {
        name: "existing-skill",
        description: "Duplicate.",
        path: "/tmp/dup",
      },
    ]);

    expect(added).toHaveLength(0);
  });

  test("returns empty array for empty input", () => {
    const added = addDiscoveredSkills([]);
    expect(added).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Integration: addDiscoveredSkills → getSystemPrompt
// ═════════════════════════════════════════════════════════════════════════════

describe("addDiscoveredSkills → getSystemPrompt integration", () => {
  beforeEach(async () => {
    await initSkills();
  });

  test("dynamically added skill appears in system prompt", () => {
    addDiscoveredSkills([
      {
        name: "dynamic-zip-skill",
        description: "Dynamically added via zip.",
        path: "/tmp/dynamic",
      },
    ]);

    const prompt = getSystemPrompt();
    expect(prompt).toContain("dynamic-zip-skill");
    expect(prompt).toContain("Dynamically added via zip.");
  });

  test("dynamically added skill appears in Available Skills section", () => {
    addDiscoveredSkills([
      {
        name: "catalog-test",
        description: "Should be in catalog.",
        path: "/tmp/catalog",
      },
    ]);

    const prompt = getSystemPrompt();
    expect(prompt).toContain("# Available Skills");
    expect(prompt).toContain("**catalog-test**");
    expect(prompt).toContain("Should be in catalog.");
  });

  test("multiple dynamically added skills all appear in prompt", () => {
    addDiscoveredSkills([
      {
        name: "skill-x",
        description: "Skill X.",
        path: "/tmp/x",
      },
      {
        name: "skill-y",
        description: "Skill Y.",
        path: "/tmp/y",
      },
    ]);

    const prompt = getSystemPrompt();
    expect(prompt).toContain("**skill-x**");
    expect(prompt).toContain("**skill-y**");
    expect(prompt).toContain("Skill X.");
    expect(prompt).toContain("Skill Y.");
  });
});
