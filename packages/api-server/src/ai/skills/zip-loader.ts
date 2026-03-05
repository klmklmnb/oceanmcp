/**
 * Zip skill loader — downloads a .zip from a CDN URL, extracts it to a
 * temporary directory, and discovers skills using the same pipeline as
 * file-based server skills.
 *
 * ## Caching
 *
 * Downloaded zips are cached on disk so that subsequent requests (e.g. new
 * WebSocket sessions) can reuse previously extracted skill directories
 * without re-downloading.
 *
 * Cache behaviour:
 *   - **HTTP cache headers respected**: `Cache-Control`, `ETag`, `Last-Modified`.
 *   - **Always revalidates on each request**: sends conditional GET
 *     (`If-None-Match` / `If-Modified-Since`) so each new session gets
 *     verified-fresh data. A `304 Not Modified` reuses the cached dir.
 *   - **`Cache-Control: no-store`**: bypasses cache entirely.
 *   - **FIFO eviction by disk size**: when total cache exceeds
 *     `OCEAN_SKILL_CACHE_MAX_MB` (default 100 MB), the oldest entries are
 *     evicted. Eviction runs asynchronously to avoid blocking the caller.
 *   - **Single zip size limit**: rejects zips larger than
 *     `OCEAN_SKILL_ZIP_MAX_MB` (default 50 MB).
 *   - **Stale-on-error**: if a conditional GET returns 5xx and a valid
 *     cached extraction exists, the stale cache is served.
 *
 * ## Supported zip directory structures
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
import { mkdir, access, unlink, readFile, writeFile, rm, readdir, stat } from "fs/promises";
import type { Sandbox, SkillMetadata } from "@ocean-mcp/shared";
import { discoverSkills, parseFrontmatter, type DiscoveredSkill } from "./discover";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Result of loading skills from a zip file.
 * Includes both the discovered skills and the extraction directory path
 * so callers can track the directory for lifecycle management (cleanup).
 */
export interface ZipLoadResult {
  /** Skills discovered from the extracted zip contents */
  skills: DiscoveredSkill[];
  /** Absolute path to the extraction directory (caller is responsible for cleanup) */
  extractDir: string;
}

/**
 * A single cache entry in the on-disk manifest.
 */
export interface ZipCacheEntry {
  /** The original zip URL (cache key) */
  url: string;
  /** ETag from the HTTP response (if provided) */
  etag?: string;
  /** Last-Modified from the HTTP response (if provided) */
  lastModified?: string;
  /** max-age value in seconds from Cache-Control (if provided) */
  maxAge?: number;
  /** Computed expiry timestamp: fetchedAt + maxAge * 1000 */
  expiresAt?: number;
  /** Absolute path to the extracted skill directory */
  extractDir: string;
  /** When the entry was last fetched or revalidated (epoch ms) */
  fetchedAt: number;
  /** Total disk size of extractDir in bytes (for FIFO eviction) */
  sizeBytes: number;
}

/**
 * On-disk cache manifest.
 */
export interface ZipCacheManifest {
  version: 1;
  entries: ZipCacheEntry[];
}

/**
 * Parsed result of a Cache-Control header.
 */
export interface CacheControlDirectives {
  maxAge?: number;
  noCache?: boolean;
  noStore?: boolean;
}

// ─── Configuration ───────────────────────────────────────────────────────────

/** Base directory for all extracted skill zips and the cache manifest */
export const ZIP_SKILLS_BASE = join(tmpdir(), "ocean-mcp-skills");

/** Path to the on-disk cache manifest */
const MANIFEST_PATH = join(ZIP_SKILLS_BASE, "cache-manifest.json");

/** Max total cache size in bytes. Default 100 MB, configurable via env. */
function getMaxCacheBytes(): number {
  const mb = Number(process.env.OCEAN_SKILL_CACHE_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 100) * 1024 * 1024;
}

/** Max single zip download size in bytes. Default 50 MB, configurable via env. */
function getMaxZipBytes(): number {
  const mb = Number(process.env.OCEAN_SKILL_ZIP_MAX_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 50) * 1024 * 1024;
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Cache-Control Parsing ───────────────────────────────────────────────────

/**
 * Parse a `Cache-Control` header value into structured directives.
 *
 * Supports `max-age`, `no-cache`, and `no-store`. Other directives are
 * ignored. Returns `{}` when the header is absent or empty.
 */
export function parseCacheControl(
  header: string | null | undefined,
): CacheControlDirectives {
  if (!header) return {};

  const directives: CacheControlDirectives = {};
  const parts = header.split(",").map((p) => p.trim().toLowerCase());

  for (const part of parts) {
    if (part === "no-cache") {
      directives.noCache = true;
    } else if (part === "no-store") {
      directives.noStore = true;
    } else if (part.startsWith("max-age=")) {
      const val = parseInt(part.slice(8), 10);
      if (Number.isFinite(val) && val >= 0) {
        directives.maxAge = val;
      }
    }
  }

  return directives;
}

// ─── Directory Size Computation ──────────────────────────────────────────────

/**
 * Recursively compute the total size of a directory in bytes.
 *
 * Counts only regular file sizes (not directory entries themselves).
 */
export async function computeDirSize(dirPath: string): Promise<number> {
  let total = 0;

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await computeDirSize(fullPath);
    } else {
      try {
        const s = await stat(fullPath);
        total += s.size;
      } catch {
        // file disappeared between readdir and stat — skip
      }
    }
  }

  return total;
}

// ─── Cache Manifest I/O ─────────────────────────────────────────────────────

/**
 * Load the cache manifest from disk.
 * Returns an empty manifest if the file doesn't exist or is corrupt.
 */
export async function loadCacheManifest(): Promise<ZipCacheManifest> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && Array.isArray(parsed.entries)) {
      return parsed as ZipCacheManifest;
    }
  } catch {
    // File doesn't exist, corrupt JSON, or wrong shape — start fresh
  }
  return { version: 1, entries: [] };
}

/**
 * Save the cache manifest to disk atomically (write-then-rename).
 */
export async function saveCacheManifest(
  manifest: ZipCacheManifest,
): Promise<void> {
  await mkdir(ZIP_SKILLS_BASE, { recursive: true });
  const tmpPath = `${MANIFEST_PATH}.tmp.${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(manifest, null, 2));
  // Atomic rename
  const { rename } = await import("fs/promises");
  await rename(tmpPath, MANIFEST_PATH);
}

// ─── FIFO Eviction ──────────────────────────────────────────────────────────

/**
 * Evict oldest cache entries (FIFO by `fetchedAt`) until total size is
 * under the configured limit.
 *
 * This function is designed to be called fire-and-forget so it doesn't
 * block the main request path.
 */
export async function evictIfNeeded(manifest: ZipCacheManifest): Promise<void> {
  const maxBytes = getMaxCacheBytes();

  // Sort by fetchedAt ascending (oldest first) for FIFO
  const sorted = [...manifest.entries].sort(
    (a, b) => a.fetchedAt - b.fetchedAt,
  );

  let totalSize = sorted.reduce((sum, e) => sum + e.sizeBytes, 0);

  if (totalSize <= maxBytes) return;

  const toEvict: ZipCacheEntry[] = [];

  for (const entry of sorted) {
    if (totalSize <= maxBytes) break;
    toEvict.push(entry);
    totalSize -= entry.sizeBytes;
  }

  if (toEvict.length === 0) return;

  const evictUrls = new Set(toEvict.map((e) => e.url));
  manifest.entries = manifest.entries.filter((e) => !evictUrls.has(e.url));

  // Delete extraction directories in parallel
  await Promise.all(
    toEvict.map((entry) =>
      rm(entry.extractDir, { recursive: true, force: true }).catch((err) =>
        console.error(
          `[ZipCache] Failed to evict dir: ${entry.extractDir}`,
          err,
        ),
      ),
    ),
  );

  await saveCacheManifest(manifest);
  console.log(
    `[ZipCache] Evicted ${toEvict.length} entry(ies) to stay under ${formatMB(maxBytes)} limit`,
  );
}

// ─── In-flight Deduplication ─────────────────────────────────────────────────

/**
 * In-memory lock map to prevent concurrent downloads for the same URL.
 * If a download for URL X is already in progress, a second call waits
 * for the first to finish and reuses its result.
 */
const inflightRequests = new Map<string, Promise<{ extractDir: string; cacheEntry: ZipCacheEntry | null }>>();

// ─── Temp Directory Management ───────────────────────────────────────────────

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

// ─── Download & Extract (low-level) ─────────────────────────────────────────

/**
 * Download a .zip file from a URL and extract it to a temporary directory.
 *
 * @param url - CDN URL pointing to a .zip file
 * @param headers - Optional extra request headers (for conditional GET)
 * @returns Object with extractDir path and HTTP response headers
 * @throws If the download fails, the response is not OK, or unzip fails
 */
async function downloadAndExtract(
  url: string,
  headers?: Record<string, string>,
): Promise<{ extractDir: string; responseHeaders: Headers; status: number }> {
  // ── 1. Fetch the zip ────────────────────────────────────────────────
  const response = await fetch(url, { headers });

  // Let the caller handle 304 and 5xx
  if (response.status === 304) {
    return {
      extractDir: "",
      responseHeaders: response.headers,
      status: 304,
    };
  }

  if (!response.ok) {
    throw new Error(
      `Failed to download skill zip: HTTP ${response.status} from ${url}`,
    );
  }

  // ── 1a. Early size check via Content-Length ──────────────────────────
  const maxZipBytes = getMaxZipBytes();
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declaredSize = parseInt(contentLength, 10);
    if (Number.isFinite(declaredSize) && declaredSize > maxZipBytes) {
      // Consume body to avoid dangling connection
      await response.arrayBuffer().catch(() => {});
      throw new Error(
        `Skill zip exceeds maximum allowed size (${formatMB(declaredSize)} > ${formatMB(maxZipBytes)} limit): ${url}`,
      );
    }
  }

  const zipBuffer = await response.arrayBuffer();

  // ── 1b. Authoritative body size check ───────────────────────────────
  if (zipBuffer.byteLength > maxZipBytes) {
    throw new Error(
      `Skill zip exceeds maximum allowed size (${formatMB(zipBuffer.byteLength)} > ${formatMB(maxZipBytes)} limit): ${url}`,
    );
  }

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

  // ── 4. Delete the zip file — no longer needed after extraction ──────
  await unlink(zipPath).catch(() => {});

  // ── 5. Handle __MACOSX and other junk directories ───────────────────
  // macOS zip files often include a __MACOSX/ directory with resource
  // forks. We leave it in place — discoverSkills will skip it since it
  // won't contain a valid SKILL.md.

  return { extractDir, responseHeaders: response.headers, status: response.status };
}

// ─── Cache-Aware Download ───────────────────────────────────────────────────

/**
 * Download a zip with full HTTP caching support.
 *
 * 1. Load manifest, find cached entry for URL.
 * 2. Always send a conditional GET (revalidate) using ETag / Last-Modified.
 *    - 304 → reuse cached extractDir, update fetchedAt.
 *    - 200 → extract to new dir, replace cache entry, clean up old dir.
 *    - 5xx → fall back to stale cache if available, otherwise throw.
 * 3. If Cache-Control: no-store → skip caching entirely.
 * 4. Save manifest, fire-and-forget eviction.
 *
 * Concurrent calls for the same URL are deduplicated.
 *
 * @returns extractDir path and the (possibly new) cache entry
 */
async function downloadAndExtractCached(
  url: string,
): Promise<{ extractDir: string; cacheEntry: ZipCacheEntry | null }> {
  // ── Deduplication: wait for in-flight request for same URL ──────────
  const inflight = inflightRequests.get(url);
  if (inflight) {
    return inflight;
  }

  const promise = _downloadAndExtractCachedImpl(url);
  inflightRequests.set(url, promise);

  try {
    return await promise;
  } finally {
    inflightRequests.delete(url);
  }
}

async function _downloadAndExtractCachedImpl(
  url: string,
): Promise<{ extractDir: string; cacheEntry: ZipCacheEntry | null }> {
  const manifest = await loadCacheManifest();
  const existingIdx = manifest.entries.findIndex((e) => e.url === url);
  const existing = existingIdx >= 0 ? manifest.entries[existingIdx] : null;

  // ── Check if cached extractDir still exists on disk ─────────────────
  let existingValid = false;
  if (existing) {
    try {
      await access(existing.extractDir);
      existingValid = true;
    } catch {
      // extractDir was deleted externally — treat as cache miss
    }
  }

  // ── Build conditional request headers ───────────────────────────────
  const reqHeaders: Record<string, string> = {};
  if (existing && existingValid) {
    if (existing.etag) {
      reqHeaders["If-None-Match"] = existing.etag;
    }
    if (existing.lastModified) {
      reqHeaders["If-Modified-Since"] = existing.lastModified;
    }
  }

  // ── Fetch ───────────────────────────────────────────────────────────
  let result: { extractDir: string; responseHeaders: Headers; status: number };
  try {
    result = await downloadAndExtract(url, reqHeaders);
  } catch (err) {
    // ── Stale-on-error: if fetch fails and we have a valid cache, use it
    if (existingValid && existing) {
      console.warn(
        `[ZipCache] Fetch failed for ${url}, serving stale cache: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Update fetchedAt so this stale entry doesn't get evicted immediately
      existing.fetchedAt = Date.now();
      await saveCacheManifest(manifest).catch(() => {});
      return { extractDir: existing.extractDir, cacheEntry: existing };
    }
    throw err;
  }

  // ── Handle 304 Not Modified ─────────────────────────────────────────
  if (result.status === 304 && existing && existingValid) {
    // Update fetchedAt and possibly refresh cache-control metadata
    const cc = parseCacheControl(result.responseHeaders.get("cache-control"));
    existing.fetchedAt = Date.now();
    if (cc.maxAge !== undefined) {
      existing.maxAge = cc.maxAge;
      existing.expiresAt = existing.fetchedAt + cc.maxAge * 1000;
    }
    await saveCacheManifest(manifest).catch(() => {});

    // Fire-and-forget eviction
    evictIfNeeded(manifest).catch((err) =>
      console.error("[ZipCache] Eviction error:", err),
    );

    return { extractDir: existing.extractDir, cacheEntry: existing };
  }

  // ── Handle 5xx with stale cache ─────────────────────────────────────
  if (result.status >= 500 && existingValid && existing) {
    console.warn(
      `[ZipCache] Server returned ${result.status} for ${url}, serving stale cache`,
    );
    existing.fetchedAt = Date.now();
    await saveCacheManifest(manifest).catch(() => {});
    return { extractDir: existing.extractDir, cacheEntry: existing };
  }

  // ── Parse cache headers from 200 response ───────────────────────────
  const cc = parseCacheControl(result.responseHeaders.get("cache-control"));

  // ── Cache-Control: no-store → skip caching ──────────────────────────
  if (cc.noStore) {
    // Clean up old cache entry if one existed
    if (existing) {
      manifest.entries.splice(existingIdx!, 1);
      await saveCacheManifest(manifest).catch(() => {});
      if (existingValid) {
        rm(existing.extractDir, { recursive: true, force: true }).catch(() => {});
      }
    }
    return { extractDir: result.extractDir, cacheEntry: null };
  }

  // ── Compute size of new extraction dir ──────────────────────────────
  const sizeBytes = await computeDirSize(result.extractDir);

  // ── Build new cache entry ───────────────────────────────────────────
  const now = Date.now();
  const etag = result.responseHeaders.get("etag") || undefined;
  const lastModified = result.responseHeaders.get("last-modified") || undefined;

  const newEntry: ZipCacheEntry = {
    url,
    etag,
    lastModified,
    maxAge: cc.maxAge,
    expiresAt: cc.maxAge !== undefined ? now + cc.maxAge * 1000 : undefined,
    extractDir: result.extractDir,
    fetchedAt: now,
    sizeBytes,
  };

  // ── Replace or insert in manifest ───────────────────────────────────
  if (existingIdx >= 0) {
    manifest.entries[existingIdx] = newEntry;
    // Clean up old extraction dir (different from new one)
    if (existing && existing.extractDir !== result.extractDir) {
      rm(existing.extractDir, { recursive: true, force: true }).catch((err) =>
        console.error(
          `[ZipCache] Failed to clean up old cache dir: ${existing.extractDir}`,
          err,
        ),
      );
    }
  } else {
    manifest.entries.push(newEntry);
  }

  await saveCacheManifest(manifest).catch(() => {});

  // Fire-and-forget eviction
  evictIfNeeded(manifest).catch((err) =>
    console.error("[ZipCache] Eviction error:", err),
  );

  return { extractDir: result.extractDir, cacheEntry: newEntry };
}

// ─── Discover Skills from Extracted Zip ──────────────────────────────────────

/**
 * Download a skill zip from a CDN URL, extract it, and discover all
 * skills inside using the same pipeline as server-side file-based skills.
 *
 * Uses HTTP caching: respects Cache-Control, ETag, and Last-Modified
 * headers. Always revalidates on each call (conditional GET). Caches
 * extracted directories on disk for reuse across sessions.
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
 * @returns Object containing discovered skills and the extraction directory path
 * @throws If download, extraction, or discovery fails entirely
 *
 * @example
 * ```ts
 * const sandbox = createNodeSandbox(process.cwd());
 * const { skills, extractDir } = await loadSkillsFromZip(
 *   sandbox,
 *   'https://cdn.example.com/skills/my-skill-pack.zip',
 * );
 * // skills = [{ name: 'my-skill', description: '...', path: '/tmp/...' }]
 * // extractDir = '/tmp/ocean-mcp-skills/<uuid>'
 * ```
 */
export async function loadSkillsFromZip(
  sandbox: Sandbox,
  url: string,
): Promise<ZipLoadResult> {
  const { extractDir } = await downloadAndExtractCached(url);

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

    return { skills: [skill], extractDir };
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

  return { skills, extractDir };
}

// ─── Cache Cleanup (for testing) ─────────────────────────────────────────────

/**
 * Clear the entire zip skill cache: removes the manifest file and all
 * cached extraction directories under ZIP_SKILLS_BASE.
 *
 * **Intended for testing only.** Do not call in production code.
 */
export async function clearZipCache(): Promise<void> {
  inflightRequests.clear();
  try {
    const manifest = await loadCacheManifest();
    await Promise.all(
      manifest.entries.map((e) =>
        rm(e.extractDir, { recursive: true, force: true }).catch(() => {}),
      ),
    );
  } catch {
    // ignore
  }
  await unlink(MANIFEST_PATH).catch(() => {});
}
