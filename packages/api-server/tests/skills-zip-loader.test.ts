import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtemp, rm, realpath, access, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createNodeSandbox } from "../src/ai/skills/sandbox";
import {
  loadSkillsFromZip,
  clearZipCache,
  parseCacheControl,
  computeDirSize,
  loadCacheManifest,
  saveCacheManifest,
  evictIfNeeded,
  ZIP_SKILLS_BASE,
  type ZipCacheManifest,
  type ZipCacheEntry,
} from "../src/ai/skills/zip-loader";

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
  await clearZipCache();
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
function buildZipBuffer(files: Record<string, string>): Uint8Array<ArrayBuffer> {
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

// ─── Enhanced server helper for cache tests ──────────────────────────────────

interface CacheableServerOptions {
  etag?: string;
  lastModified?: string;
  cacheControl?: string;
  /** If true, include Content-Length header in responses */
  includeContentLength?: boolean;
}

interface CacheableServer {
  url: string;
  stop: () => void;
  /** Number of HTTP requests received */
  requestCount: () => number;
  /** Headers from the last received request */
  lastRequestHeaders: () => Headers | null;
  /** All received request headers (one per request) */
  allRequestHeaders: () => Headers[];
}

/**
 * Start an HTTP server that serves a zip file with configurable cache headers.
 *
 * Supports conditional requests:
 *   - If client sends `If-None-Match` matching the configured ETag → 304
 *   - If client sends `If-Modified-Since` matching the configured Last-Modified → 304
 */
function serveCacheable(
  zipData: Uint8Array<ArrayBuffer>,
  options: CacheableServerOptions = {},
): CacheableServer {
  let reqCount = 0;
  let lastHeaders: Headers | null = null;
  const allHeaders: Headers[] = [];

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      reqCount++;
      lastHeaders = req.headers;
      allHeaders.push(new Headers(req.headers));

      // ── Conditional GET checks ─────────────────────────────────────
      if (options.etag) {
        const ifNoneMatch = req.headers.get("if-none-match");
        if (ifNoneMatch === options.etag) {
          return new Response(null, {
            status: 304,
            headers: {
              ...(options.etag ? { ETag: options.etag } : {}),
              ...(options.cacheControl ? { "Cache-Control": options.cacheControl } : {}),
            },
          });
        }
      }

      if (options.lastModified) {
        const ifModifiedSince = req.headers.get("if-modified-since");
        if (ifModifiedSince === options.lastModified) {
          return new Response(null, {
            status: 304,
            headers: {
              ...(options.lastModified ? { "Last-Modified": options.lastModified } : {}),
              ...(options.cacheControl ? { "Cache-Control": options.cacheControl } : {}),
            },
          });
        }
      }

      // ── Full response ──────────────────────────────────────────────
      const responseHeaders: Record<string, string> = {};
      if (options.etag) responseHeaders["ETag"] = options.etag;
      if (options.lastModified) responseHeaders["Last-Modified"] = options.lastModified;
      if (options.cacheControl) responseHeaders["Cache-Control"] = options.cacheControl;
      if (options.includeContentLength !== false) {
        responseHeaders["Content-Length"] = String(zipData.byteLength);
      }

      return new Response(zipData, { headers: responseHeaders });
    },
  });

  return {
    url: `http://localhost:${server.port}/skill.zip`,
    stop: () => server.stop(true),
    requestCount: () => reqCount,
    lastRequestHeaders: () => lastHeaders,
    allRequestHeaders: () => allHeaders,
  };
}

/** Standard SKILL.md content for cache tests */
const CACHE_SKILL_MD = `---
name: cache-test-skill
description: A skill for testing HTTP caching.
---

# Cache Test Skill

Instructions for the cache test skill.
`;

const CACHE_SKILL_MD_V2 = `---
name: cache-test-skill-v2
description: Updated skill for testing HTTP caching.
---

# Cache Test Skill V2

Updated instructions.
`;

/** Build a standard test zip for cache tests */
function buildCacheTestZip(content = CACHE_SKILL_MD): Uint8Array<ArrayBuffer> {
  return buildZipBuffer({ "SKILL.md": content });
}

// ═════════════════════════════════════════════════════════════════════════════
// Return shape
// ═════════════════════════════════════════════════════════════════════════════

describe("loadSkillsFromZip — return shape", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

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
  beforeEach(async () => {
    await clearZipCache();
  });

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
  beforeEach(async () => {
    await clearZipCache();
  });

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
// Case 3: Nested / wrapper directory (3+ levels deep)
// ═════════════════════════════════════════════════════════════════════════════

describe("loadSkillsFromZip — nested wrapper directories", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("discovers skills inside a single wrapper directory", async () => {
    // Common pattern: zip tool wraps everything in a single root dir
    // wrapper/
    //   skill-a/
    //     SKILL.md
    //   skill-b/
    //     SKILL.md
    const zipPath = await createTestZip("wrapper-single", {
      "wrapper/skill-a/SKILL.md": `---
name: wrapped-a
description: Wrapped skill A.
---

# Wrapped A
`,
      "wrapper/skill-b/SKILL.md": `---
name: wrapped-b
description: Wrapped skill B.
---

# Wrapped B
`,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(2);
      const names = skills.map((s) => s.name).sort();
      expect(names).toEqual(["wrapped-a", "wrapped-b"]);
    } finally {
      stop();
    }
  });

  test("discovers single skill with SKILL.md inside a wrapper directory", async () => {
    // wrapper/
    //   SKILL.md
    //   references/
    //     guide.md
    const zipPath = await createTestZip("wrapper-root-skill", {
      "wrapper/SKILL.md": `---
name: wrapped-root
description: Root skill inside a wrapper.
---

# Wrapped Root Skill
`,
      "wrapper/references/guide.md": "# Guide",
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("wrapped-root");
    } finally {
      stop();
    }
  });

  test("handles double-nested wrapper directories", async () => {
    // outer/inner/
    //   skill-a/
    //     SKILL.md
    const zipPath = await createTestZip("wrapper-double", {
      "outer/inner/skill-a/SKILL.md": `---
name: deep-skill
description: Deeply nested skill.
---

# Deep Skill
`,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("deep-skill");
    } finally {
      stop();
    }
  });

  test("wrapper with __MACOSX is unwrapped correctly", async () => {
    // Many macOS-created zips have a __MACOSX sibling alongside the real content dir.
    // The wrapper detection should ignore __MACOSX.
    // __MACOSX/
    //   ...
    // real-content/
    //   skill-a/
    //     SKILL.md
    const zipPath = await createTestZip("wrapper-macosx", {
      "__MACOSX/._skill-a": "binary resource fork junk",
      "real-content/skill-a/SKILL.md": `---
name: macosx-wrapped
description: Skill in a zip with __MACOSX junk.
---

# macOS Wrapped Skill
`,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("macosx-wrapped");
    } finally {
      stop();
    }
  });

  test("does NOT unwrap when multiple real directories exist at root", async () => {
    // If there are multiple real dirs at root (not __MACOSX), these ARE the skill dirs.
    // No unwrapping should happen — this is standard Case 2.
    const zipPath = await createTestZip("no-unwrap-multi", {
      "skill-a/SKILL.md": `---
name: no-unwrap-a
description: Skill A at root.
---
`,
      "skill-b/SKILL.md": `---
name: no-unwrap-b
description: Skill B at root.
---
`,
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);

      expect(skills).toHaveLength(2);
      const names = skills.map((s) => s.name).sort();
      expect(names).toEqual(["no-unwrap-a", "no-unwrap-b"]);
    } finally {
      stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Error cases
// ═════════════════════════════════════════════════════════════════════════════

describe("loadSkillsFromZip — error handling", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

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
  beforeEach(async () => {
    await clearZipCache();
  });

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

  test("zip-extracted skill resource files are readable via resourcePath", async () => {
    const { createLoadSkillTool } = await import("../src/ai/skills/loader");

    const zipPath = await createTestZip("e2e-resource-read", {
      "my-skill/SKILL.md": `---
name: e2e-resource-skill
description: Skill with nested resource files.
---

# Instructions

Read _node-lib/INDEX.md for the index.
`,
      "my-skill/_node-lib/INDEX.md": "# Node Index\n\n- llm -> event-fixed_llm.md",
      "my-skill/_node-lib/event-fixed_llm.md": "# LLM Node\n\nDefault LLM properties here.",
    });

    const { url, stop } = serveFile(zipPath);
    try {
      const { skills } = await loadSkillsFromZip(sandbox, url);
      expect(skills).toHaveLength(1);

      const tool = createLoadSkillTool(sandbox, skills, []);

      // First: load the skill normally to get the resources listing
      const loadResult = await tool.execute!(
        { name: "e2e-resource-skill" },
        { toolCallId: "test", messages: [] } as any,
      );
      const resources: string[] = (loadResult as any).resources;
      expect(resources).toContain("_node-lib/");
      expect(resources).toContain("_node-lib/INDEX.md");
      expect(resources).toContain("_node-lib/event-fixed_llm.md");

      // Second: read a specific resource file using resourcePath
      const indexResult = await tool.execute!(
        { name: "e2e-resource-skill", resourcePath: "_node-lib/INDEX.md" },
        { toolCallId: "test", messages: [] } as any,
      );
      expect(indexResult).not.toHaveProperty("error");
      expect((indexResult as any).content).toContain("# Node Index");
      expect((indexResult as any).content).toContain("event-fixed_llm.md");
      expect((indexResult as any).resourcePath).toBe("_node-lib/INDEX.md");

      // Third: read another resource file
      const llmResult = await tool.execute!(
        { name: "e2e-resource-skill", resourcePath: "_node-lib/event-fixed_llm.md" },
        { toolCallId: "test", messages: [] } as any,
      );
      expect(llmResult).not.toHaveProperty("error");
      expect((llmResult as any).content).toContain("# LLM Node");
      expect((llmResult as any).content).toContain("Default LLM properties here.");
    } finally {
      stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Real-world CDN zip (integration smoke test)
// ═════════════════════════════════════════════════════════════════════════════

const REAL_CDN_ZIP_URL =
  "https://fastcdn.mihoyo.com/static-resource-v2/2026/02/27/7cc1ae17ed278759a3ba318dafcecf27_7974366858840692508.zip";

describe("loadSkillsFromZip — real-world CDN zip", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("discovers multiple subdirectory skills from CDN zip", async () => {
    const { skills, extractDir } = await loadSkillsFromZip(sandbox, REAL_CDN_ZIP_URL);

    // This zip contains 3 skill subdirectories
    expect(skills.length).toBe(3);

    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual([
      "ai-copy-delete-paste-flow",
      "ai-create-flow",
      "flow-sdk-resource-id",
    ]);

    // Each skill should have a valid description
    for (const skill of skills) {
      expect(skill.description).toBeTruthy();
      expect(typeof skill.description).toBe("string");
    }

    // Each skill path should be a subdirectory of extractDir
    for (const skill of skills) {
      expect(skill.path).toContain(extractDir);
    }
  });

  test("second call reuses cache via conditional GET", async () => {
    // First call: full download
    const result1 = await loadSkillsFromZip(sandbox, REAL_CDN_ZIP_URL);
    expect(result1.skills.length).toBe(3);

    // Second call: should reuse cache (304 via ETag/Last-Modified)
    const result2 = await loadSkillsFromZip(sandbox, REAL_CDN_ZIP_URL);
    expect(result2.skills.length).toBe(3);

    // Same extractDir reused (cache hit)
    expect(result2.extractDir).toBe(result1.extractDir);

    // Cache entry should have ETag and Last-Modified from CDN
    const manifest = await loadCacheManifest();
    const entry = manifest.entries.find((e) => e.url === REAL_CDN_ZIP_URL);
    expect(entry).toBeDefined();
    expect(entry!.etag).toBeTruthy();
    expect(entry!.lastModified).toBeTruthy();
    expect(entry!.maxAge).toBe(31536000); // CDN returns max-age=31536000 (1 year)
  });

  test("CDN skill resources are readable via loadSkill tool", async () => {
    const { createLoadSkillTool } = await import("../src/ai/skills/loader");

    const { skills } = await loadSkillsFromZip(sandbox, REAL_CDN_ZIP_URL);
    const tool = createLoadSkillTool(sandbox, skills, []);

    // Load ai-create-flow skill — should have _node-lib/ resources
    const result = await tool.execute!(
      { name: "ai-create-flow" },
      { toolCallId: "test", messages: [] } as any,
    );

    expect(result).not.toHaveProperty("error");
    expect((result as any).content).toBeTruthy();
    expect((result as any).skillDirectory).toBeTruthy();

    const resources: string[] = (result as any).resources;
    expect(resources).toContain("_node-lib/");
    expect(resources).toContain("_node-lib/INDEX.md");

    // Read a specific resource file
    const indexResult = await tool.execute!(
      { name: "ai-create-flow", resourcePath: "_node-lib/INDEX.md" },
      { toolCallId: "test", messages: [] } as any,
    );
    expect(indexResult).not.toHaveProperty("error");
    expect((indexResult as any).content).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cache-Control header parsing
// ═════════════════════════════════════════════════════════════════════════════

describe("parseCacheControl", () => {
  test("parses max-age=3600", () => {
    expect(parseCacheControl("max-age=3600")).toEqual({ maxAge: 3600 });
  });

  test("parses max-age=0", () => {
    expect(parseCacheControl("max-age=0")).toEqual({ maxAge: 0 });
  });

  test("parses no-cache", () => {
    expect(parseCacheControl("no-cache")).toEqual({ noCache: true });
  });

  test("parses no-store", () => {
    expect(parseCacheControl("no-store")).toEqual({ noStore: true });
  });

  test("parses combo: public, max-age=86400", () => {
    const result = parseCacheControl("public, max-age=86400");
    expect(result.maxAge).toBe(86400);
  });

  test("handles undefined header", () => {
    expect(parseCacheControl(undefined)).toEqual({});
  });

  test("handles null header", () => {
    expect(parseCacheControl(null)).toEqual({});
  });

  test("handles empty string", () => {
    expect(parseCacheControl("")).toEqual({});
  });

  test("case-insensitive parsing", () => {
    expect(parseCacheControl("Max-Age=600")).toEqual({ maxAge: 600 });
    expect(parseCacheControl("No-Cache")).toEqual({ noCache: true });
    expect(parseCacheControl("NO-STORE")).toEqual({ noStore: true });
  });

  test("parses combined no-cache and max-age", () => {
    const result = parseCacheControl("no-cache, max-age=300");
    expect(result.noCache).toBe(true);
    expect(result.maxAge).toBe(300);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cache manifest persistence
// ═════════════════════════════════════════════════════════════════════════════

describe("Cache manifest persistence", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("returns empty manifest when file doesn't exist", async () => {
    const manifest = await loadCacheManifest();
    expect(manifest.version).toBe(1);
    expect(manifest.entries).toEqual([]);
  });

  test("saves and loads roundtrip", async () => {
    const manifest: ZipCacheManifest = {
      version: 1,
      entries: [
        {
          url: "https://example.com/skill.zip",
          etag: '"abc123"',
          lastModified: "Wed, 01 Jan 2025 00:00:00 GMT",
          maxAge: 3600,
          expiresAt: Date.now() + 3600_000,
          extractDir: "/tmp/test-dir",
          fetchedAt: Date.now(),
          sizeBytes: 1024,
        },
      ],
    };

    await saveCacheManifest(manifest);
    const loaded = await loadCacheManifest();

    expect(loaded.version).toBe(1);
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0].url).toBe("https://example.com/skill.zip");
    expect(loaded.entries[0].etag).toBe('"abc123"');
    expect(loaded.entries[0].lastModified).toBe("Wed, 01 Jan 2025 00:00:00 GMT");
    expect(loaded.entries[0].maxAge).toBe(3600);
    expect(loaded.entries[0].sizeBytes).toBe(1024);
  });

  test("handles corrupt JSON gracefully", async () => {
    await mkdir(ZIP_SKILLS_BASE, { recursive: true });
    const manifestPath = join(ZIP_SKILLS_BASE, "cache-manifest.json");
    await writeFile(manifestPath, "this is not valid json{{{");

    const manifest = await loadCacheManifest();
    expect(manifest.version).toBe(1);
    expect(manifest.entries).toEqual([]);
  });

  test("creates parent directory if missing", async () => {
    // clearZipCache above may have cleaned up; this should still work
    const manifest: ZipCacheManifest = {
      version: 1,
      entries: [],
    };
    // Should not throw even if ZIP_SKILLS_BASE doesn't exist
    await saveCacheManifest(manifest);
    const loaded = await loadCacheManifest();
    expect(loaded.version).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// computeDirSize utility
// ═════════════════════════════════════════════════════════════════════════════

describe("computeDirSize", () => {
  test("computes correct size for flat directory", async () => {
    const dir = join(tempDir, "size-flat");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "a.txt"), "hello"); // 5 bytes
    await writeFile(join(dir, "b.txt"), "world!"); // 6 bytes

    const size = await computeDirSize(dir);
    expect(size).toBe(11);
  });

  test("computes correct size for nested directory", async () => {
    const dir = join(tempDir, "size-nested");
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "root.txt"), "abc"); // 3 bytes
    await writeFile(join(dir, "sub", "child.txt"), "defgh"); // 5 bytes

    const size = await computeDirSize(dir);
    expect(size).toBe(8);
  });

  test("returns 0 for empty directory", async () => {
    const dir = join(tempDir, "size-empty");
    await mkdir(dir, { recursive: true });

    const size = await computeDirSize(dir);
    expect(size).toBe(0);
  });

  test("returns 0 for non-existent directory", async () => {
    const size = await computeDirSize(join(tempDir, "does-not-exist"));
    expect(size).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cache hit — reuses cached extraction (conditional GET → 304)
// ═════════════════════════════════════════════════════════════════════════════

describe("Cache hit — reuses cached extraction", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("second call reuses cache via ETag conditional GET (304)", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, {
      etag: '"v1"',
      cacheControl: "max-age=3600",
    });

    try {
      // First call: full download
      const result1 = await loadSkillsFromZip(sandbox, server.url);
      expect(result1.skills).toHaveLength(1);
      expect(result1.skills[0].name).toBe("cache-test-skill");
      expect(server.requestCount()).toBe(1);

      // Second call: should send conditional GET and get 304
      const result2 = await loadSkillsFromZip(sandbox, server.url);
      expect(result2.skills).toHaveLength(1);
      expect(result2.skills[0].name).toBe("cache-test-skill");
      expect(server.requestCount()).toBe(2); // always revalidates

      // Same extractDir reused
      expect(result2.extractDir).toBe(result1.extractDir);
    } finally {
      server.stop();
    }
  });

  test("second call reuses cache via Last-Modified conditional GET (304)", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, {
      lastModified: "Wed, 01 Jan 2025 00:00:00 GMT",
      cacheControl: "max-age=3600",
    });

    try {
      const result1 = await loadSkillsFromZip(sandbox, server.url);
      expect(server.requestCount()).toBe(1);

      const result2 = await loadSkillsFromZip(sandbox, server.url);
      expect(server.requestCount()).toBe(2);
      expect(result2.extractDir).toBe(result1.extractDir);

      // Verify If-Modified-Since was sent
      const secondReqHeaders = server.allRequestHeaders()[1];
      expect(secondReqHeaders.get("if-modified-since")).toBe("Wed, 01 Jan 2025 00:00:00 GMT");
    } finally {
      server.stop();
    }
  });

  test("both ETag and Last-Modified sent in conditional request", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, {
      etag: '"abc"',
      lastModified: "Thu, 15 May 2025 12:00:00 GMT",
    });

    try {
      await loadSkillsFromZip(sandbox, server.url);
      await loadSkillsFromZip(sandbox, server.url);

      const secondReqHeaders = server.allRequestHeaders()[1];
      expect(secondReqHeaders.get("if-none-match")).toBe('"abc"');
      expect(secondReqHeaders.get("if-modified-since")).toBe("Thu, 15 May 2025 12:00:00 GMT");
    } finally {
      server.stop();
    }
  });

  test("cached extractDir contents are intact on cache hit", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, { etag: '"intact"' });

    try {
      const result1 = await loadSkillsFromZip(sandbox, server.url);
      const result2 = await loadSkillsFromZip(sandbox, server.url);

      // extractDir should still be readable
      const content = await sandbox.readFile(join(result2.extractDir, "SKILL.md"), "utf-8");
      expect(content).toContain("cache-test-skill");
    } finally {
      server.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cache miss — full download
// ═════════════════════════════════════════════════════════════════════════════

describe("Cache miss — full download", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("server returns 200 on conditional GET (content changed)", async () => {
    const zipV1 = buildCacheTestZip(CACHE_SKILL_MD);
    const zipV2 = buildCacheTestZip(CACHE_SKILL_MD_V2);

    // First: serve v1 with etag "v1"
    let currentZip = zipV1;
    let currentEtag = '"v1"';
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const ifNoneMatch = req.headers.get("if-none-match");
        if (ifNoneMatch === currentEtag) {
          return new Response(null, { status: 304, headers: { ETag: currentEtag } });
        }
        return new Response(currentZip, {
          headers: { ETag: currentEtag, "Content-Length": String(currentZip.byteLength) },
        });
      },
    });
    const url = `http://localhost:${server.port}/skill.zip`;

    try {
      // First download
      const result1 = await loadSkillsFromZip(sandbox, url);
      expect(result1.skills[0].name).toBe("cache-test-skill");

      // Switch to v2
      currentZip = zipV2;
      currentEtag = '"v2"';

      // Second download: conditional GET returns 200 (etag mismatch)
      const result2 = await loadSkillsFromZip(sandbox, url);
      expect(result2.skills[0].name).toBe("cache-test-skill-v2");

      // Different extractDir (new extraction)
      expect(result2.extractDir).not.toBe(result1.extractDir);
    } finally {
      server.stop(true);
    }
  });

  test("no cache entry exists — cold start full download", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, { etag: '"cold"' });

    try {
      // No prior cache — should do full download
      const result = await loadSkillsFromZip(sandbox, server.url);
      expect(result.skills).toHaveLength(1);
      expect(server.requestCount()).toBe(1);

      // First request should NOT have conditional headers
      const firstHeaders = server.allRequestHeaders()[0];
      expect(firstHeaders.get("if-none-match")).toBeNull();
      expect(firstHeaders.get("if-modified-since")).toBeNull();

      // Cache entry should now exist
      const manifest = await loadCacheManifest();
      const entry = manifest.entries.find((e) => e.url === server.url);
      expect(entry).toBeDefined();
      expect(entry!.etag).toBe('"cold"');
    } finally {
      server.stop();
    }
  });

  test("cache entry exists but extractDir missing from disk — falls back to full download", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, { etag: '"missing-dir"' });

    try {
      // First download to populate cache
      const result1 = await loadSkillsFromZip(sandbox, server.url);
      expect(server.requestCount()).toBe(1);

      // Manually delete the extractDir
      await rm(result1.extractDir, { recursive: true, force: true });

      // Second call: cache entry exists but dir is missing → full download
      const result2 = await loadSkillsFromZip(sandbox, server.url);
      expect(server.requestCount()).toBe(2);
      expect(result2.skills).toHaveLength(1);

      // Should have a new extractDir
      expect(result2.extractDir).not.toBe(result1.extractDir);

      // First request should NOT have conditional headers (dir missing → no conditionals)
      const secondHeaders = server.allRequestHeaders()[1];
      expect(secondHeaders.get("if-none-match")).toBeNull();
    } finally {
      server.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cache-Control: no-store
// ═════════════════════════════════════════════════════════════════════════════

describe("Cache-Control: no-store", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("no-store bypasses cache entirely", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, {
      cacheControl: "no-store",
    });

    try {
      // First download
      const result1 = await loadSkillsFromZip(sandbox, server.url);
      expect(result1.skills).toHaveLength(1);
      expect(server.requestCount()).toBe(1);

      // No cache entry should be stored
      let manifest = await loadCacheManifest();
      expect(manifest.entries.find((e) => e.url === server.url)).toBeUndefined();

      // Second download: full download again (no cache)
      const result2 = await loadSkillsFromZip(sandbox, server.url);
      expect(result2.skills).toHaveLength(1);
      expect(server.requestCount()).toBe(2);

      // Still no cache entry
      manifest = await loadCacheManifest();
      expect(manifest.entries.find((e) => e.url === server.url)).toBeUndefined();
    } finally {
      server.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cache-Control: no-cache
// ═════════════════════════════════════════════════════════════════════════════

describe("Cache-Control: no-cache", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("no-cache always revalidates (sends conditional headers)", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, {
      etag: '"nc"',
      cacheControl: "no-cache",
    });

    try {
      await loadSkillsFromZip(sandbox, server.url);
      expect(server.requestCount()).toBe(1);

      // Cache entry SHOULD exist (no-cache means "revalidate", not "don't cache")
      const manifest = await loadCacheManifest();
      expect(manifest.entries.find((e) => e.url === server.url)).toBeDefined();

      await loadSkillsFromZip(sandbox, server.url);
      expect(server.requestCount()).toBe(2);

      // Should have sent conditional headers
      const secondHeaders = server.allRequestHeaders()[1];
      expect(secondHeaders.get("if-none-match")).toBe('"nc"');
    } finally {
      server.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// HTTP response headers captured correctly
// ═════════════════════════════════════════════════════════════════════════════

describe("HTTP response headers captured in cache entry", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("ETag stored in cache entry", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, { etag: '"test-etag-123"' });

    try {
      await loadSkillsFromZip(sandbox, server.url);
      const manifest = await loadCacheManifest();
      const entry = manifest.entries.find((e) => e.url === server.url);
      expect(entry).toBeDefined();
      expect(entry!.etag).toBe('"test-etag-123"');
    } finally {
      server.stop();
    }
  });

  test("Last-Modified stored in cache entry", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, {
      lastModified: "Wed, 01 Jan 2025 00:00:00 GMT",
    });

    try {
      await loadSkillsFromZip(sandbox, server.url);
      const manifest = await loadCacheManifest();
      const entry = manifest.entries.find((e) => e.url === server.url);
      expect(entry!.lastModified).toBe("Wed, 01 Jan 2025 00:00:00 GMT");
    } finally {
      server.stop();
    }
  });

  test("Cache-Control max-age stored and expiresAt computed", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, {
      cacheControl: "max-age=3600",
    });

    try {
      const before = Date.now();
      await loadSkillsFromZip(sandbox, server.url);
      const after = Date.now();

      const manifest = await loadCacheManifest();
      const entry = manifest.entries.find((e) => e.url === server.url);
      expect(entry!.maxAge).toBe(3600);
      expect(entry!.expiresAt).toBeDefined();
      // expiresAt should be fetchedAt + 3600 * 1000
      expect(entry!.expiresAt!).toBeGreaterThanOrEqual(before + 3600_000);
      expect(entry!.expiresAt!).toBeLessThanOrEqual(after + 3600_000);
    } finally {
      server.stop();
    }
  });

  test("no cache headers — entry still created with undefined fields", async () => {
    const zipData = buildCacheTestZip();
    // Server with NO cache headers at all
    const server = serveCacheable(zipData, {});

    try {
      await loadSkillsFromZip(sandbox, server.url);
      const manifest = await loadCacheManifest();
      const entry = manifest.entries.find((e) => e.url === server.url);
      expect(entry).toBeDefined();
      expect(entry!.etag).toBeUndefined();
      expect(entry!.lastModified).toBeUndefined();
      expect(entry!.maxAge).toBeUndefined();
      expect(entry!.expiresAt).toBeUndefined();
    } finally {
      server.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Conditional GET request headers
// ═════════════════════════════════════════════════════════════════════════════

describe("Conditional GET request headers", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("sends If-None-Match when ETag is cached", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, { etag: '"cond-etag"' });

    try {
      await loadSkillsFromZip(sandbox, server.url);
      await loadSkillsFromZip(sandbox, server.url);

      const secondHeaders = server.allRequestHeaders()[1];
      expect(secondHeaders.get("if-none-match")).toBe('"cond-etag"');
    } finally {
      server.stop();
    }
  });

  test("sends If-Modified-Since when Last-Modified is cached", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, {
      lastModified: "Fri, 20 Jun 2025 10:30:00 GMT",
    });

    try {
      await loadSkillsFromZip(sandbox, server.url);
      await loadSkillsFromZip(sandbox, server.url);

      const secondHeaders = server.allRequestHeaders()[1];
      expect(secondHeaders.get("if-modified-since")).toBe("Fri, 20 Jun 2025 10:30:00 GMT");
    } finally {
      server.stop();
    }
  });

  test("sends neither conditional header when no cache metadata", async () => {
    const zipData = buildCacheTestZip();
    // Server sends no ETag/Last-Modified
    const server = serveCacheable(zipData, {});

    try {
      await loadSkillsFromZip(sandbox, server.url);
      await loadSkillsFromZip(sandbox, server.url);

      const secondHeaders = server.allRequestHeaders()[1];
      expect(secondHeaders.get("if-none-match")).toBeNull();
      expect(secondHeaders.get("if-modified-since")).toBeNull();
    } finally {
      server.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FIFO eviction by disk size
// ═════════════════════════════════════════════════════════════════════════════

describe("FIFO eviction by disk size", () => {
  const originalEnv = process.env.OCEAN_SKILL_CACHE_MAX_MB;

  beforeEach(async () => {
    await clearZipCache();
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.OCEAN_SKILL_CACHE_MAX_MB = originalEnv;
    } else {
      delete process.env.OCEAN_SKILL_CACHE_MAX_MB;
    }
  });

  test("eviction triggers when total size exceeds limit", async () => {
    // Set a very small cache limit: 0.001 MB = ~1 KB
    process.env.OCEAN_SKILL_CACHE_MAX_MB = "0.001";

    const zip1 = buildCacheTestZip(`---
name: evict-skill-1
description: First skill.
---
# Skill 1
${"x".repeat(500)}
`);
    const zip2 = buildCacheTestZip(`---
name: evict-skill-2
description: Second skill.
---
# Skill 2
${"y".repeat(500)}
`);

    const server1 = serveCacheable(zip1, { etag: '"ev1"' });
    const server2 = serveCacheable(zip2, { etag: '"ev2"' });

    try {
      const result1 = await loadSkillsFromZip(sandbox, server1.url);

      // Load second zip — triggers eviction of first
      await loadSkillsFromZip(sandbox, server2.url);

      // Wait briefly for async eviction
      await new Promise((r) => setTimeout(r, 200));

      const manifest = await loadCacheManifest();
      const urls = manifest.entries.map((e) => e.url);

      // At minimum, the second URL should be in the cache
      expect(urls).toContain(server2.url);

      // First entry should have been evicted (FIFO by fetchedAt)
      // because total exceeds 1 KB
      expect(urls).not.toContain(server1.url);

      // First extractDir should have been deleted
      await expect(access(result1.extractDir)).rejects.toThrow();
    } finally {
      server1.stop();
      server2.stop();
      delete process.env.OCEAN_SKILL_CACHE_MAX_MB;
    }
  });

  test("eviction removes oldest entry first (FIFO)", async () => {
    process.env.OCEAN_SKILL_CACHE_MAX_MB = "0.001";

    const zip1 = buildCacheTestZip(`---
name: fifo-1
description: Oldest.
---
# S1
${"a".repeat(400)}
`);
    const zip2 = buildCacheTestZip(`---
name: fifo-2
description: Middle.
---
# S2
${"b".repeat(400)}
`);
    const zip3 = buildCacheTestZip(`---
name: fifo-3
description: Newest.
---
# S3
${"c".repeat(400)}
`);

    const s1 = serveCacheable(zip1, { etag: '"f1"' });
    const s2 = serveCacheable(zip2, { etag: '"f2"' });
    const s3 = serveCacheable(zip3, { etag: '"f3"' });

    try {
      await loadSkillsFromZip(sandbox, s1.url);
      // small delay to ensure different fetchedAt timestamps
      await new Promise((r) => setTimeout(r, 20));
      await loadSkillsFromZip(sandbox, s2.url);
      await new Promise((r) => setTimeout(r, 20));
      await loadSkillsFromZip(sandbox, s3.url);

      // Wait for async eviction
      await new Promise((r) => setTimeout(r, 200));

      const manifest = await loadCacheManifest();
      const urls = manifest.entries.map((e) => e.url);

      // Newest should be retained; oldest should be evicted first
      expect(urls).toContain(s3.url);
    } finally {
      s1.stop();
      s2.stop();
      s3.stop();
      delete process.env.OCEAN_SKILL_CACHE_MAX_MB;
    }
  });

  test("sizeBytes is computed and stored correctly", async () => {
    delete process.env.OCEAN_SKILL_CACHE_MAX_MB; // use default (100 MB)

    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, { etag: '"size-check"' });

    try {
      const result = await loadSkillsFromZip(sandbox, server.url);

      const manifest = await loadCacheManifest();
      const entry = manifest.entries.find((e) => e.url === server.url);
      expect(entry).toBeDefined();
      expect(entry!.sizeBytes).toBeGreaterThan(0);

      // Verify sizeBytes matches actual dir size
      const actualSize = await computeDirSize(result.extractDir);
      expect(entry!.sizeBytes).toBe(actualSize);
    } finally {
      server.stop();
    }
  });

  test("newly cached entry is present even before eviction completes", async () => {
    process.env.OCEAN_SKILL_CACHE_MAX_MB = "0.001";

    const zip1 = buildCacheTestZip(`---
name: pre-evict-1
description: Old.
---
# S1
${"x".repeat(500)}
`);
    const zip2 = buildCacheTestZip(`---
name: pre-evict-2
description: New.
---
# S2
${"y".repeat(500)}
`);

    const s1 = serveCacheable(zip1, { etag: '"pe1"' });
    const s2 = serveCacheable(zip2, { etag: '"pe2"' });

    try {
      await loadSkillsFromZip(sandbox, s1.url);

      // Load second zip — triggers eviction (async) but should return immediately
      const result2 = await loadSkillsFromZip(sandbox, s2.url);

      // The new skill should be immediately usable
      expect(result2.skills).toHaveLength(1);
      expect(result2.skills[0].name).toBe("pre-evict-2");
    } finally {
      s1.stop();
      s2.stop();
      delete process.env.OCEAN_SKILL_CACHE_MAX_MB;
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Concurrent requests for same URL (deduplication)
// ═════════════════════════════════════════════════════════════════════════════

describe("Concurrent requests — deduplication", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("deduplicates concurrent downloads for same URL", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, { etag: '"dedup"' });

    try {
      // Fire two requests simultaneously
      const [result1, result2] = await Promise.all([
        loadSkillsFromZip(sandbox, server.url),
        loadSkillsFromZip(sandbox, server.url),
      ]);

      // Only ONE HTTP request should have been made
      expect(server.requestCount()).toBe(1);

      // Both should get valid results
      expect(result1.skills).toHaveLength(1);
      expect(result2.skills).toHaveLength(1);
      expect(result1.extractDir).toBe(result2.extractDir);
    } finally {
      server.stop();
    }
  });

  test("both concurrent callers get valid results", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, {});

    try {
      const results = await Promise.all([
        loadSkillsFromZip(sandbox, server.url),
        loadSkillsFromZip(sandbox, server.url),
        loadSkillsFromZip(sandbox, server.url),
      ]);

      for (const result of results) {
        expect(result.skills).toHaveLength(1);
        expect(result.skills[0].name).toBe("cache-test-skill");
        expect(result.extractDir).toBe(results[0].extractDir);
      }
    } finally {
      server.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Stale-on-error: serve stale cache when server returns 5xx
// ═════════════════════════════════════════════════════════════════════════════

describe("Stale-on-error — 5xx fallback", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("serves stale cache when revalidation returns 5xx", async () => {
    const zipData = buildCacheTestZip();
    let shouldFail = false;

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (shouldFail) {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response(zipData, {
          headers: {
            ETag: '"stale-test"',
            "Content-Length": String(zipData.byteLength),
          },
        });
      },
    });
    const url = `http://localhost:${server.port}/skill.zip`;

    try {
      // First call: successful download
      const result1 = await loadSkillsFromZip(sandbox, url);
      expect(result1.skills[0].name).toBe("cache-test-skill");

      // Now make the server fail
      shouldFail = true;

      // Second call: should serve stale cache instead of throwing
      const result2 = await loadSkillsFromZip(sandbox, url);
      expect(result2.skills[0].name).toBe("cache-test-skill");
      expect(result2.extractDir).toBe(result1.extractDir);
    } finally {
      server.stop(true);
    }
  });

  test("throws when no cache exists and server returns 5xx", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("Internal Server Error", { status: 500 });
      },
    });
    const url = `http://localhost:${server.port}/skill.zip`;

    try {
      await expect(loadSkillsFromZip(sandbox, url)).rejects.toThrow(
        "Failed to download skill zip: HTTP 500",
      );
    } finally {
      server.stop(true);
    }
  });

  test("serves stale cache when fetch itself fails (network error)", async () => {
    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, { etag: '"net-err"' });

    try {
      // First call: successful
      const result1 = await loadSkillsFromZip(sandbox, server.url);
      expect(result1.skills).toHaveLength(1);

      // Stop the server to simulate network error
      server.stop();

      // Small delay to ensure the server is fully stopped
      await new Promise((r) => setTimeout(r, 50));

      // Second call: server unreachable → should serve stale cache
      const result2 = await loadSkillsFromZip(sandbox, server.url);
      expect(result2.skills[0].name).toBe("cache-test-skill");
      expect(result2.extractDir).toBe(result1.extractDir);
    } finally {
      // server already stopped
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Single zip file size limit
// ═════════════════════════════════════════════════════════════════════════════

describe("Single zip file size limit", () => {
  const originalEnv = process.env.OCEAN_SKILL_ZIP_MAX_MB;

  beforeEach(async () => {
    await clearZipCache();
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.OCEAN_SKILL_ZIP_MAX_MB = originalEnv;
    } else {
      delete process.env.OCEAN_SKILL_ZIP_MAX_MB;
    }
  });

  test("rejects zip exceeding custom limit from env", async () => {
    // Set limit to ~1 KB
    process.env.OCEAN_SKILL_ZIP_MAX_MB = "0.001";

    const zipData = buildCacheTestZip(`---
name: big-skill
description: Too big.
---
# Big Skill
${"x".repeat(2000)}
`);
    const server = serveCacheable(zipData, {});

    try {
      await expect(loadSkillsFromZip(sandbox, server.url)).rejects.toThrow(
        /exceeds maximum allowed size/,
      );
    } finally {
      server.stop();
      delete process.env.OCEAN_SKILL_ZIP_MAX_MB;
    }
  });

  test("accepts zip under the limit", async () => {
    // 10 MB limit — our test zips are tiny
    process.env.OCEAN_SKILL_ZIP_MAX_MB = "10";

    const zipData = buildCacheTestZip();
    const server = serveCacheable(zipData, {});

    try {
      const result = await loadSkillsFromZip(sandbox, server.url);
      expect(result.skills).toHaveLength(1);
    } finally {
      server.stop();
      delete process.env.OCEAN_SKILL_ZIP_MAX_MB;
    }
  });

  test("checks actual body size, not just Content-Length", async () => {
    // Tiny limit
    process.env.OCEAN_SKILL_ZIP_MAX_MB = "0.001";

    // Build a zip that's bigger than 1 KB
    const zipData = buildCacheTestZip(`---
name: sneaky-skill
description: Sneaky.
---
${"z".repeat(2000)}
`);

    // Server lies about Content-Length (says it's small)
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(zipData, {
          headers: { "Content-Length": "100" }, // lies!
        });
      },
    });
    const url = `http://localhost:${server.port}/skill.zip`;

    try {
      await expect(loadSkillsFromZip(sandbox, url)).rejects.toThrow(
        /exceeds maximum allowed size/,
      );
    } finally {
      server.stop(true);
      delete process.env.OCEAN_SKILL_ZIP_MAX_MB;
    }
  });

  test("rejects early via Content-Length before downloading full body", async () => {
    // Tiny limit
    process.env.OCEAN_SKILL_ZIP_MAX_MB = "0.001";

    // Build a zip that's bigger than 1 KB to ensure the Content-Length
    // header matches a large body (Bun may override Content-Length for
    // small bodies that don't match the declared size).
    const bigContent = "x".repeat(5000);
    const bigZip = buildCacheTestZip(`---
name: big-cl-skill
description: Big via Content-Length.
---
${bigContent}
`);
    const server = serveCacheable(bigZip, { includeContentLength: true });

    try {
      await expect(loadSkillsFromZip(sandbox, server.url)).rejects.toThrow(
        /exceeds maximum allowed size/,
      );
    } finally {
      server.stop();
      delete process.env.OCEAN_SKILL_ZIP_MAX_MB;
    }
  });

  test("handles missing Content-Length header — checks body size", async () => {
    process.env.OCEAN_SKILL_ZIP_MAX_MB = "0.001";

    const zipData = buildCacheTestZip(`---
name: no-cl-skill
description: No content length.
---
${"w".repeat(2000)}
`);

    // Server sends no Content-Length
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(zipData); // no Content-Length header
      },
    });
    const url = `http://localhost:${server.port}/skill.zip`;

    try {
      await expect(loadSkillsFromZip(sandbox, url)).rejects.toThrow(
        /exceeds maximum allowed size/,
      );
    } finally {
      server.stop(true);
      delete process.env.OCEAN_SKILL_ZIP_MAX_MB;
    }
  });

  test("no cache entry written when size limit exceeded", async () => {
    process.env.OCEAN_SKILL_ZIP_MAX_MB = "0.001";

    const zipData = buildCacheTestZip(`---
name: no-cache-big
description: Should not be cached.
---
${"q".repeat(2000)}
`);
    const server = serveCacheable(zipData, { etag: '"no-cache-big"' });

    try {
      await expect(loadSkillsFromZip(sandbox, server.url)).rejects.toThrow(
        /exceeds maximum allowed size/,
      );

      const manifest = await loadCacheManifest();
      expect(manifest.entries.find((e) => e.url === server.url)).toBeUndefined();
    } finally {
      server.stop();
      delete process.env.OCEAN_SKILL_ZIP_MAX_MB;
    }
  });

  test("error message includes actual size and limit", async () => {
    process.env.OCEAN_SKILL_ZIP_MAX_MB = "0.001";

    const zipData = buildCacheTestZip(`---
name: msg-skill
description: Check error message.
---
${"m".repeat(2000)}
`);
    const server = serveCacheable(zipData, {});

    try {
      await expect(loadSkillsFromZip(sandbox, server.url)).rejects.toThrow(
        /\d+\.\d+ MB.*\d+\.\d+ MB/,
      );
    } finally {
      server.stop();
      delete process.env.OCEAN_SKILL_ZIP_MAX_MB;
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// URL with query parameters treated as separate cache keys
// ═════════════════════════════════════════════════════════════════════════════

describe("URL query parameters as separate cache keys", () => {
  beforeEach(async () => {
    await clearZipCache();
  });

  test("different query parameters are separate cache entries", async () => {
    const zip1 = buildCacheTestZip(`---
name: query-v1
description: Version 1.
---
# V1
`);
    const zip2 = buildCacheTestZip(`---
name: query-v2
description: Version 2.
---
# V2
`);

    const s1 = serveCacheable(zip1, { etag: '"q1"' });
    const s2 = serveCacheable(zip2, { etag: '"q2"' });

    // Construct URLs with different query params
    const url1 = s1.url + "?v=1";
    const url2 = s2.url + "?v=2";

    try {
      const result1 = await loadSkillsFromZip(sandbox, url1);
      const result2 = await loadSkillsFromZip(sandbox, url2);

      expect(result1.skills[0].name).toBe("query-v1");
      expect(result2.skills[0].name).toBe("query-v2");

      // Both should be cached as separate entries
      const manifest = await loadCacheManifest();
      expect(manifest.entries).toHaveLength(2);
      const cachedUrls = manifest.entries.map((e) => e.url);
      expect(cachedUrls).toContain(url1);
      expect(cachedUrls).toContain(url2);
    } finally {
      s1.stop();
      s2.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// evictIfNeeded unit tests
// ═════════════════════════════════════════════════════════════════════════════

describe("evictIfNeeded", () => {
  const originalEnv = process.env.OCEAN_SKILL_CACHE_MAX_MB;

  beforeEach(async () => {
    await clearZipCache();
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.OCEAN_SKILL_CACHE_MAX_MB = originalEnv;
    } else {
      delete process.env.OCEAN_SKILL_CACHE_MAX_MB;
    }
  });

  test("does nothing when total size is under limit", async () => {
    delete process.env.OCEAN_SKILL_CACHE_MAX_MB; // 100 MB default

    const manifest: ZipCacheManifest = {
      version: 1,
      entries: [
        {
          url: "https://example.com/a.zip",
          extractDir: "/tmp/nonexistent-a",
          fetchedAt: Date.now(),
          sizeBytes: 1024,
        },
      ],
    };

    await saveCacheManifest(manifest);
    await evictIfNeeded(manifest);

    // Entry should still exist
    expect(manifest.entries).toHaveLength(1);
  });

  test("evicts entries until under limit", async () => {
    process.env.OCEAN_SKILL_CACHE_MAX_MB = "0.001"; // ~1 KB

    // Create real directories so eviction can rm them
    const dir1 = join(tempDir, "evict-dir-1");
    const dir2 = join(tempDir, "evict-dir-2");
    const dir3 = join(tempDir, "evict-dir-3");
    await mkdir(dir1, { recursive: true });
    await mkdir(dir2, { recursive: true });
    await mkdir(dir3, { recursive: true });
    await writeFile(join(dir1, "data.txt"), "x".repeat(500));
    await writeFile(join(dir2, "data.txt"), "y".repeat(500));
    await writeFile(join(dir3, "data.txt"), "z".repeat(500));

    const manifest: ZipCacheManifest = {
      version: 1,
      entries: [
        { url: "https://a.com/a.zip", extractDir: dir1, fetchedAt: 1000, sizeBytes: 500 },
        { url: "https://b.com/b.zip", extractDir: dir2, fetchedAt: 2000, sizeBytes: 500 },
        { url: "https://c.com/c.zip", extractDir: dir3, fetchedAt: 3000, sizeBytes: 500 },
      ],
    };

    await saveCacheManifest(manifest);
    await evictIfNeeded(manifest);

    // Total was 1500 bytes, limit is ~1024 bytes
    // Should evict oldest first until under limit
    expect(manifest.entries.length).toBeLessThan(3);

    // The newest entry (c) should survive
    const urls = manifest.entries.map((e) => e.url);
    expect(urls).toContain("https://c.com/c.zip");

    delete process.env.OCEAN_SKILL_CACHE_MAX_MB;
  });
});
