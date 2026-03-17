/**
 * NodeSandbox — local filesystem implementation of the Sandbox interface.
 *
 * Uses Node.js `fs/promises` for file operations and `Bun.spawn` for
 * command execution. This is the default sandbox used when skills live
 * on disk (e.g. `packages/api-server/skills/`).
 *
 * ────────────────────────────────────────────────────────────────────────
 * Future: remote skill sources
 * ────────────────────────────────────────────────────────────────────────
 * To load skills from a CDN or cloud storage, implement a separate
 * `RemoteSandbox` that satisfies the same `Sandbox` interface:
 *
 *   export function createRemoteSandbox(baseUrl: string): Sandbox {
 *     return {
 *       async readFile(path) {
 *         const res = await fetch(`${baseUrl}/${path}`);
 *         if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
 *         return res.text();
 *       },
 *       async readdir(path) {
 *         // The CDN must serve a manifest.json at each directory listing:
 *         //   [ { "name": "my-skill", "type": "dir" }, ... ]
 *         const res = await fetch(`${baseUrl}/${path}/manifest.json`);
 *         if (!res.ok) throw new Error(`HTTP ${res.status}`);
 *         const entries: { name: string; type: 'file' | 'dir' }[] = await res.json();
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
 * The discovery and loading code (`discoverSkills`, `createLoadSkillTool`)
 * would require zero changes — they only depend on the `Sandbox` interface.
 * ────────────────────────────────────────────────────────────────────────
 */

import { readFile, readdir } from "fs/promises";
import type { Sandbox } from "oceanmcp-shared";

/**
 * Create a `Sandbox` backed by the local Node.js / Bun filesystem.
 *
 * @param workingDirectory - Default working directory for `exec()` commands.
 *   Typically the api-server package root or the project root.
 * @returns A Sandbox instance using local fs + Bun.spawn
 *
 * @example
 * ```ts
 * const sandbox = createNodeSandbox('/path/to/api-server');
 * const content = await sandbox.readFile('/path/to/skills/my-skill/SKILL.md', 'utf-8');
 * ```
 */
export function createNodeSandbox(workingDirectory: string): Sandbox {
  return {
    /**
     * Read a file from the local filesystem.
     * Delegates directly to Node.js fs/promises.readFile.
     */
    readFile: (path, encoding) => readFile(path, { encoding }),

    /**
     * List directory entries from the local filesystem.
     * Returns a simplified shape matching SandboxDirEntry (name + isDirectory).
     */
    readdir: async (path, _opts) => {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        isDirectory: () => e.isDirectory(),
      }));
    },

    /**
     * Execute a shell command using Bun.spawn.
     *
     * We use `sh -c` to interpret the command string as a shell expression,
     * allowing pipes, redirects, and other shell features in skill scripts.
     *
     * Both stdout and stderr are captured as strings and returned. The caller
     * is responsible for checking stderr or exit codes as needed.
     */
    exec: async (command, opts) => {
      const proc = Bun.spawn(["sh", "-c", command], {
        cwd: opts?.cwd ?? workingDirectory,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      return { stdout, stderr };
    },
  };
}
