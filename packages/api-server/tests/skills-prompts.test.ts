import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  initSkills,
  getSystemPrompt,
  getSkillsContext,
} from "../src/ai/prompts";
import { connectionManager } from "../src/ws/connection-manager";
import type { DiscoveredSkill } from "../src/ai/skills/discover";

// ─────────────────────────────────────────────────────────────────────────────
// Tests for session-isolated zip skills via ConnectionManager
//
// These tests verify that:
//   1. Zip skills registered for one connection are visible only to that connection
//   2. Zip skills appear in getSystemPrompt() and getSkillsContext() for the owning connection
//   3. Zip skills from different URLs coexist within a connection
//   4. Re-registering the same URL replaces the previous skills
//   5. Skills are cleaned up on disconnect
// ─────────────────────────────────────────────────────────────────────────────

// Mock WS object for connection registration
function createMockWs(connectionId: string) {
  return {
    data: { connectionId },
    send: () => {},
    close: () => {},
  } as any;
}

describe("zip skills — session isolation", () => {
  const connA = "conn-a";
  const connB = "conn-b";

  beforeEach(async () => {
    await initSkills();
    // Set up two mock connections
    connectionManager.addConnection(connA, createMockWs(connA));
    connectionManager.addConnection(connB, createMockWs(connB));
  });

  // Clean up connections after each test
  afterEach(() => {
    connectionManager.removeConnection(connA);
    connectionManager.removeConnection(connB);
  });

  test("zip skills registered for connection A are visible to A", () => {
    const skills: DiscoveredSkill[] = [
      { name: "zip-skill-a", description: "Skill for A.", path: "/tmp/a" },
    ];
    connectionManager.registerZipSkills(connA, "https://example.com/a.zip", skills, "/tmp/a");

    const { skills: ctx } = getSkillsContext(connA);
    const zipSkill = ctx.find((s) => s.name === "zip-skill-a");
    expect(zipSkill).toBeDefined();
    expect(zipSkill!.description).toBe("Skill for A.");
  });

  test("zip skills registered for connection A are NOT visible to B", () => {
    const skills: DiscoveredSkill[] = [
      { name: "zip-skill-a", description: "Skill for A.", path: "/tmp/a" },
    ];
    connectionManager.registerZipSkills(connA, "https://example.com/a.zip", skills, "/tmp/a");

    const { skills: ctx } = getSkillsContext(connB);
    const zipSkill = ctx.find((s) => s.name === "zip-skill-a");
    expect(zipSkill).toBeUndefined();
  });

  test("zip skills appear in getSystemPrompt for the owning connection", () => {
    const skills: DiscoveredSkill[] = [
      { name: "prompt-visible", description: "Should appear in prompt.", path: "/tmp/pv" },
    ];
    connectionManager.registerZipSkills(connA, "https://example.com/pv.zip", skills, "/tmp/pv");

    const promptA = getSystemPrompt(connA);
    expect(promptA).toContain("**prompt-visible**");
    expect(promptA).toContain("Should appear in prompt.");

    const promptB = getSystemPrompt(connB);
    expect(promptB).not.toContain("prompt-visible");
  });

  test("file-based skills are visible to all connections", async () => {
    // initSkills discovers the example skill — it should be global
    const promptA = getSystemPrompt(connA);
    const promptB = getSystemPrompt(connB);

    // Both should see the file-based skill (if any exist)
    const { skills: fileSkills } = getSkillsContext();
    if (fileSkills.length > 0) {
      expect(promptA).toContain(fileSkills[0].name);
      expect(promptB).toContain(fileSkills[0].name);
    }
  });
});

describe("zip skills — multi-URL coexistence", () => {
  const connId = "conn-multi";

  beforeEach(async () => {
    await initSkills();
    connectionManager.addConnection(connId, createMockWs(connId));
  });

  afterEach(() => {
    connectionManager.removeConnection(connId);
  });

  test("skills from different URLs coexist in the same connection", () => {
    connectionManager.registerZipSkills(
      connId,
      "https://cdn.example.com/pack-1.zip",
      [{ name: "skill-from-pack-1", description: "Pack 1.", path: "/tmp/p1" }],
      "/tmp/p1",
    );
    connectionManager.registerZipSkills(
      connId,
      "https://cdn.example.com/pack-2.zip",
      [{ name: "skill-from-pack-2", description: "Pack 2.", path: "/tmp/p2" }],
      "/tmp/p2",
    );

    const zipSkills = connectionManager.getZipSkills(connId);
    expect(zipSkills).toHaveLength(2);
    const names = zipSkills.map((s) => s.name).sort();
    expect(names).toEqual(["skill-from-pack-1", "skill-from-pack-2"]);
  });

  test("multiple zip URLs all appear in system prompt", () => {
    connectionManager.registerZipSkills(
      connId,
      "https://cdn.example.com/a.zip",
      [{ name: "zip-a", description: "A.", path: "/tmp/a" }],
      "/tmp/a",
    );
    connectionManager.registerZipSkills(
      connId,
      "https://cdn.example.com/b.zip",
      [{ name: "zip-b", description: "B.", path: "/tmp/b" }],
      "/tmp/b",
    );

    const prompt = getSystemPrompt(connId);
    expect(prompt).toContain("**zip-a**");
    expect(prompt).toContain("**zip-b**");
  });

  test("multiple zip URLs all appear in getSkillsContext", () => {
    connectionManager.registerZipSkills(
      connId,
      "https://cdn.example.com/x.zip",
      [{ name: "skill-x", description: "X.", path: "/tmp/x" }],
      "/tmp/x",
    );
    connectionManager.registerZipSkills(
      connId,
      "https://cdn.example.com/y.zip",
      [{ name: "skill-y", description: "Y.", path: "/tmp/y" }],
      "/tmp/y",
    );

    const { skills } = getSkillsContext(connId);
    const zipNames = skills.filter((s) =>
      s.name === "skill-x" || s.name === "skill-y",
    );
    expect(zipNames).toHaveLength(2);
  });
});

describe("zip skills — per-URL replacement", () => {
  const connId = "conn-replace";
  const url = "https://cdn.example.com/replaceable.zip";

  beforeEach(async () => {
    await initSkills();
    connectionManager.addConnection(connId, createMockWs(connId));
  });

  afterEach(() => {
    connectionManager.removeConnection(connId);
  });

  test("re-registering same URL replaces skills", () => {
    connectionManager.registerZipSkills(
      connId,
      url,
      [{ name: "old-skill", description: "Old version.", path: "/tmp/old" }],
      "/tmp/old",
    );

    // Verify old skill is there
    let zipSkills = connectionManager.getZipSkills(connId);
    expect(zipSkills.find((s) => s.name === "old-skill")).toBeDefined();

    // Re-register with same URL but different skills
    connectionManager.registerZipSkills(
      connId,
      url,
      [{ name: "new-skill", description: "New version.", path: "/tmp/new" }],
      "/tmp/new",
    );

    // Old skill should be gone, new skill should be present
    zipSkills = connectionManager.getZipSkills(connId);
    expect(zipSkills.find((s) => s.name === "old-skill")).toBeUndefined();
    expect(zipSkills.find((s) => s.name === "new-skill")).toBeDefined();
  });

  test("re-registering one URL does NOT affect other URLs", () => {
    const otherUrl = "https://cdn.example.com/other.zip";

    connectionManager.registerZipSkills(
      connId,
      url,
      [{ name: "replaceable-skill", description: "Will change.", path: "/tmp/r" }],
      "/tmp/r",
    );
    connectionManager.registerZipSkills(
      connId,
      otherUrl,
      [{ name: "stable-skill", description: "Should stay.", path: "/tmp/s" }],
      "/tmp/s",
    );

    // Replace only the first URL
    connectionManager.registerZipSkills(
      connId,
      url,
      [{ name: "replaced-skill", description: "Changed.", path: "/tmp/r2" }],
      "/tmp/r2",
    );

    const zipSkills = connectionManager.getZipSkills(connId);
    expect(zipSkills).toHaveLength(2);
    expect(zipSkills.find((s) => s.name === "stable-skill")).toBeDefined();
    expect(zipSkills.find((s) => s.name === "replaced-skill")).toBeDefined();
    expect(zipSkills.find((s) => s.name === "replaceable-skill")).toBeUndefined();
  });
});

describe("zip skills — cleanup on disconnect", () => {
  test("getZipSkills returns empty after disconnect", async () => {
    const connId = "conn-cleanup";
    await initSkills();
    connectionManager.addConnection(connId, createMockWs(connId));

    connectionManager.registerZipSkills(
      connId,
      "https://cdn.example.com/temp.zip",
      [{ name: "temp-skill", description: "Temp.", path: "/tmp/temp" }],
      "/tmp/temp",
    );

    expect(connectionManager.getZipSkills(connId)).toHaveLength(1);

    // Disconnect
    connectionManager.removeConnection(connId);

    // Should be empty now
    expect(connectionManager.getZipSkills(connId)).toHaveLength(0);
  });

  test("disconnecting one connection does not affect another", async () => {
    const connA = "conn-cleanup-a";
    const connB = "conn-cleanup-b";
    await initSkills();
    connectionManager.addConnection(connA, createMockWs(connA));
    connectionManager.addConnection(connB, createMockWs(connB));

    connectionManager.registerZipSkills(
      connA,
      "https://cdn.example.com/a.zip",
      [{ name: "skill-a", description: "A.", path: "/tmp/a" }],
      "/tmp/a",
    );
    connectionManager.registerZipSkills(
      connB,
      "https://cdn.example.com/b.zip",
      [{ name: "skill-b", description: "B.", path: "/tmp/b" }],
      "/tmp/b",
    );

    // Disconnect A
    connectionManager.removeConnection(connA);

    // A's skills gone
    expect(connectionManager.getZipSkills(connA)).toHaveLength(0);
    // B's skills still there
    expect(connectionManager.getZipSkills(connB)).toHaveLength(1);
    expect(connectionManager.getZipSkills(connB)[0].name).toBe("skill-b");

    // Cleanup
    connectionManager.removeConnection(connB);
  });
});
