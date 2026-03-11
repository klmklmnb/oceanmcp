/**
 * Centralized Winston logger for the api-server.
 *
 * Configuration is driven by environment variables:
 *
 *   - `LOG_PREFIX`  — Instance identifier included in log filenames and
 *                     every log line label. Useful for multi-instance
 *                     deployments where each instance writes to the same
 *                     log directory.  (default: `"ocean-mcp"`)
 *
 *   - `NODE_ENV`    — When set to `"production"`, log files are written
 *                     to `/srv-logs/`. Otherwise (dev mode) they are
 *                     written to `<project>/packages/api-server/logs/`.
 *
 *   - `DEBUG`       — When `"true"`, the log level is set to `"debug"`.
 *                     Otherwise it defaults to `"info"`.
 *
 * Log files (basic file transports, no rotation):
 *   - `{LOG_PREFIX}-combined.log`  — all levels
 *   - `{LOG_PREFIX}-error.log`     — error level only
 *
 * Console transport:
 *   - Always active. Colorized in dev mode, plain JSON in production.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";
import winston from "winston";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Configuration ───────────────────────────────────────────────────────────

const getRuntimeEnv = (key: string) => process.env[key];

const NODE_ENV = getRuntimeEnv("NODE_ENV");
const LOG_PREFIX = getRuntimeEnv("LOG_PREFIX") || "ocean-mcp";
const IS_PRODUCTION = NODE_ENV === "production";
const LOG_LEVEL = getRuntimeEnv("DEBUG") === "true" ? "debug" : "info";

// Dev mode: project-local logs/  |  Production: /srv-logs/
const LOG_DIR = IS_PRODUCTION
  ? "/srv-logs"
  : join(__dirname, "../../logs");

// Ensure the log directory exists
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch (error) {
  // If we can't create the directory (e.g. permission denied on /srv-logs),
  // file transports will fail gracefully — console transport still works.
}

// ─── Format ──────────────────────────────────────────────────────────────────

const { combine, timestamp, printf, colorize, errors } = winston.format;

/**
 * Shared log line format:
 *   2026-03-11T10:23:45.678Z [INFO] [ocean-mcp] Some message here
 *
 * When metadata / splat args are present they are appended as JSON.
 */
const logFormat = printf((info) => {
  const { level, message, timestamp: ts, ...meta } = info;
  const metaStr =
    Object.keys(meta).length > 0 ? " " + JSON.stringify(meta) : "";
  return `${ts} [${level}] [${LOG_PREFIX}] ${message}${metaStr}`;
});

// File transports: errors → timestamp → UPPERCASE level → printf
const fileFormat = combine(
  errors({ stack: true }),
  timestamp(),
  // Uppercase the level for file output (no ANSI codes to worry about)
  winston.format((info) => { info.level = info.level.toUpperCase(); return info; })(),
  logFormat,
);

// Console transport: errors → timestamp → colorize (uppercased level) → printf
// colorize must run AFTER we uppercase the level but BEFORE printf, so the
// ANSI codes wrap the already-uppercased string and printf just interpolates it.
const consoleFormat = combine(
  errors({ stack: true }),
  timestamp(),
  winston.format((info) => { info.level = info.level.toUpperCase(); return info; })(),
  colorize({ level: true }),
  logFormat,
);

// ─── Transports ──────────────────────────────────────────────────────────────

const combinedFileTransport = new winston.transports.File({
  filename: join(LOG_DIR, `${LOG_PREFIX}-combined.log`),
  format: fileFormat,
});

const errorFileTransport = new winston.transports.File({
  filename: join(LOG_DIR, `${LOG_PREFIX}-error.log`),
  level: "error",
  format: fileFormat,
});

const transports: winston.transport[] = [
  // Console — colorized in dev, plain in production
  new winston.transports.Console({
    format: IS_PRODUCTION ? fileFormat : consoleFormat,
  }),

  // Combined log file — all levels
  combinedFileTransport,

  // Error-only log file
  errorFileTransport,
];

// ─── Logger Instance ─────────────────────────────────────────────────────────

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  transports,
});

// ─── Console Mock for Code Tools ─────────────────────────────────────────────

/**
 * Creates a `console`-like object that routes all output through the
 * winston logger. Intended to be injected into `new Function()` execution
 * contexts so that `console.log(xx)` inside code-string tools is
 * captured by the structured logger instead of going to raw stdout.
 *
 * All output is tagged with `[CodeTool]` for easy filtering.
 */
export function createCodeToolConsoleMock(): Pick<
  Console,
  "log" | "error" | "warn" | "info" | "debug"
> {
  const format = (...args: unknown[]) =>
    args
      .map((a) =>
        typeof a === "string" ? a : JSON.stringify(a, null, 2) ?? String(a),
      )
      .join(" ");

  return {
    log: (...args: unknown[]) => logger.info(`[CodeTool] ${format(...args)}`),
    info: (...args: unknown[]) => logger.info(`[CodeTool] ${format(...args)}`),
    warn: (...args: unknown[]) => logger.warn(`[CodeTool] ${format(...args)}`),
    error: (...args: unknown[]) =>
      logger.error(`[CodeTool] ${format(...args)}`),
    debug: (...args: unknown[]) =>
      logger.debug(`[CodeTool] ${format(...args)}`),
  };
}
