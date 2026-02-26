/**
 * Sandbox — generic abstraction over filesystem + command execution.
 *
 * Design rationale
 * ────────────────
 * The skills system needs to read SKILL.md files and optionally execute
 * bundled scripts. Today these live on the local filesystem (NodeSandbox),
 * but in the future they may be fetched from:
 *
 *   - A CDN URL (e.g. https://skills.cdn.example.com/my-skill/SKILL.md)
 *   - A cloud storage bucket (S3, GCS)
 *   - A containerized sandbox environment (E2B, Docker)
 *   - An in-memory virtual filesystem (for testing)
 *
 * By coding against this interface instead of `fs` directly, the entire
 * skills discovery / loading pipeline stays unchanged when the underlying
 * storage changes — only a new Sandbox implementation is needed.
 *
 * The interface mirrors the Node.js `fs/promises` + `child_process` API
 * surface *just enough* to support skill operations, without pulling in
 * the full fs API.
 *
 * Future CDN support path
 * ───────────────────────
 * A `RemoteSandbox` implementation would look roughly like:
 *
 *   function createRemoteSandbox(baseUrl: string): Sandbox {
 *     return {
 *       async readFile(path) {
 *         const res = await fetch(`${baseUrl}/${path}`);
 *         if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
 *         return res.text();
 *       },
 *       async readdir(path) {
 *         // Fetch a manifest.json that lists skill directories.
 *         // The CDN would need to serve this manifest at each directory level.
 *         const res = await fetch(`${baseUrl}/${path}/manifest.json`);
 *         if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}/manifest.json`);
 *         const entries: Array<{ name: string; type: 'file' | 'dir' }> = await res.json();
 *         return entries.map(e => ({
 *           name: e.name,
 *           isDirectory: () => e.type === 'dir',
 *         }));
 *       },
 *       async exec() {
 *         throw new Error('Command execution is not supported in remote sandbox');
 *       },
 *     };
 *   }
 *
 * The callers (discoverSkills, loadSkill, buildSkillsPrompt) require
 * zero code changes — they only depend on this interface.
 */

// ─── Directory Entry ─────────────────────────────────────────────────────────

/**
 * Minimal directory entry returned by `Sandbox.readdir()`.
 * Mirrors the shape of `fs.Dirent` but only exposes what skills need.
 */
export interface SandboxDirEntry {
  /** Entry name (file or directory name, not full path) */
  name: string;
  /** Returns true if this entry is a directory */
  isDirectory(): boolean;
}

// ─── Exec Result ─────────────────────────────────────────────────────────────

/**
 * Result of a shell command execution.
 * Mirrors the shape of `child_process.exec` output.
 */
export interface SandboxExecResult {
  /** Standard output captured from the command */
  stdout: string;
  /** Standard error captured from the command */
  stderr: string;
}

// ─── Sandbox Interface ───────────────────────────────────────────────────────

export interface Sandbox {
  /**
   * Read the entire contents of a file as a UTF-8 string.
   *
   * @param path - Absolute or sandbox-relative path to the file
   * @param encoding - Always 'utf-8' (parameter kept for API symmetry with fs)
   * @returns The file contents as a string
   * @throws If the file does not exist or cannot be read
   */
  readFile(path: string, encoding: "utf-8"): Promise<string>;

  /**
   * List entries in a directory, each annotated with `isDirectory()`.
   *
   * @param path - Absolute or sandbox-relative path to the directory
   * @param opts - Must be `{ withFileTypes: true }` (kept for API symmetry)
   * @returns Array of directory entries
   * @throws If the directory does not exist or cannot be read
   */
  readdir(
    path: string,
    opts: { withFileTypes: true },
  ): Promise<SandboxDirEntry[]>;

  /**
   * Execute a shell command and return captured stdout / stderr.
   *
   * For read-only sandbox implementations (e.g. CDN, in-memory),
   * this method should throw an "exec not supported" error.
   *
   * @param command - Shell command string to execute
   * @param opts - Optional execution options
   * @param opts.cwd - Working directory override
   * @returns Captured stdout and stderr
   * @throws If execution fails or is not supported by this sandbox
   */
  exec(
    command: string,
    opts?: { cwd?: string },
  ): Promise<SandboxExecResult>;
}
