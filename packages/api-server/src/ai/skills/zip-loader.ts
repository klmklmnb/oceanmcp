/**
 * Zip skill loader — downloads a .zip from a CDN URL, extracts it to a
 * temporary directory, and discovers skills using the same pipeline as
 * file-based server skills.
 *
 * Supported zip directory structures:
 *
 *   ── Case 1: Root-level SKILL.md (single skill) ──────────────────────
 *   zip/
 *   ├── SKILL.md          → Treated as a single skill
 *   ├── references/       → Bundled resources accessible via skillDirectory
 *   └── assets/           → More resources
 *
 *   When SKILL.md exists at the root, the entire extraction directory is
 *   the skill. Subdirectories are NOT scanned for additional skills.
 *
 *   ── Case 2: Subdirectory skills (one or more) ──────────────────────
 *   zip/
 *   ├── skill-a/
 *   │   ├── SKILL.md      → Skill A
 *   │   └── references/
 *   └── skill-b/
 *       └── SKILL.md      → Skill B
 *
 *   When no root SKILL.md exists, each subdirectory containing a SKILL.md
 *   is discovered as a separate skill (via the standard `discoverSkills`
 *   pipeline).
 *
 * Extraction uses the system `unzip` binary (available on macOS / Linux).
 * No additional npm dependencies are required.
 */

import { tmpdir } from "os";
import { join } from "path";
import { mkdir, access } from "fs/promises";
import type { Sandbox, SkillMetadata } from "@ocean-mcp/shared";
import { discoverSkills, parseFrontmatter, type DiscoveredSkill } from "./discover";

// ─── Temp Directory Management ───────────────────────────────────────────────

/** Base directory for all extracted skill zips */
const ZIP_SKILLS_BASE = join(tmpdir(), "ocean-mcp-skills");

/**
 * Create a unique extraction directory under the system temp dir.
 *
 * @returns Absolute path to the newly created directory
 */
async function createExtractionDir(): Promise<string> {
  const id = crypto.randomUUID();
  const dir = join(ZIP_SKILLS_BASE, id);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ─── Download & Extract ──────────────────────────────────────────────────────

/**
 * Download a .zip file from a URL and extract it to a temporary directory.
 *
 * @param url - CDN URL pointing to a .zip file
 * @returns Absolute path to the extraction directory
 * @throws If the download fails, the response is not OK, or unzip fails
 */
async function downloadAndExtract(url: string): Promise<string> {
  // ── 1. Fetch the zip ────────────────────────────────────────────────
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download skill zip: HTTP ${response.status} from ${url}`,
    );
  }

  const zipBuffer = await response.arrayBuffer();
  if (zipBuffer.byteLength === 0) {
    throw new Error(`Skill zip is empty: ${url}`);
  }

  // ── 2. Write zip to a temp file ─────────────────────────────────────
  const extractDir = await createExtractionDir();
  const zipPath = join(extractDir, "__skill.zip");
  await Bun.write(zipPath, zipBuffer);

  // ── 3. Extract using system `unzip` ─────────────────────────────────
  const proc = Bun.spawn(["unzip", "-o", "-q", zipPath, "-d", extractDir], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(
      `Failed to extract skill zip (exit code ${exitCode}): ${stderr.trim() || "unknown error"}`,
    );
  }

  // ── 4. Handle __MACOSX and other junk directories ───────────────────
  // macOS zip files often include a __MACOSX/ directory with resource
  // forks. We leave it in place — discoverSkills will skip it since it
  // won't contain a valid SKILL.md.

  return extractDir;
}

// ─── Discover Skills from Extracted Zip ──────────────────────────────────────

/**
 * Download a skill zip from a CDN URL, extract it, and discover all
 * skills inside using the same pipeline as server-side file-based skills.
 *
 * Directory structure rules:
 *   - If `SKILL.md` exists at the extraction root → treat the entire
 *     directory as a single skill. Subdirectories are NOT scanned.
 *   - Otherwise → scan subdirectories for `SKILL.md` files (standard
 *     `discoverSkills` behavior). Each subdirectory with a valid
 *     `SKILL.md` becomes a separate skill.
 *
 * @param sandbox - Filesystem abstraction for reading extracted files
 * @param url - CDN URL pointing to the .zip file
 * @returns Array of discovered skills with metadata and filesystem paths
 * @throws If download, extraction, or discovery fails entirely
 *
 * @example
 * ```ts
 * const sandbox = createNodeSandbox(process.cwd());
 * const skills = await loadSkillsFromZip(
 *   sandbox,
 *   'https://cdn.example.com/skills/my-skill-pack.zip',
 * );
 * // skills = [{ name: 'my-skill', description: '...', path: '/tmp/...' }]
 * ```
 */
export async function loadSkillsFromZip(
  sandbox: Sandbox,
  url: string,
): Promise<DiscoveredSkill[]> {
  const extractDir = await downloadAndExtract(url);

  // ── Check for root-level SKILL.md ─────────────────────────────────
  const rootSkillPath = join(extractDir, "SKILL.md");

  try {
    await access(rootSkillPath);

    // Root SKILL.md exists → single skill, skip subdirectory scanning
    const content = await sandbox.readFile(rootSkillPath, "utf-8");
    const frontmatter = parseFrontmatter(content);

    const skill: DiscoveredSkill = {
      name: frontmatter.name,
      description: frontmatter.description,
      path: extractDir,
    };

    return [skill];
  } catch {
    // No root SKILL.md — fall through to subdirectory scanning
  }

  // ── Scan subdirectories (standard discoverSkills pipeline) ────────
  const skills = await discoverSkills(sandbox, [extractDir]);

  if (skills.length === 0) {
    throw new Error(
      `No skills found in zip from ${url}. ` +
        `Expected either a root-level SKILL.md or subdirectories containing SKILL.md files.`,
    );
  }

  return skills;
}
