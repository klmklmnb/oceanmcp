import {
  MAX_ARRAY_LENGTH,
  MAX_DEPTH,
  MAX_OBJECT_KEYS,
  MAX_STRING_LENGTH,
} from "./constants";
import type { PrimitiveTagValue } from "./types";

export function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_STRING_LENGTH - 3)}...`;
}

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Error) {
    return { name: value.name, message: truncateString(value.message) };
  }

  if (value instanceof URL) {
    return value.origin + value.pathname;
  }

  if (depth >= MAX_DEPTH) {
    return "[Truncated]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_OBJECT_KEYS)
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)]),
    );
  }

  return truncateString(String(value));
}

export function sanitizeRecord(
  record: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!record) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, sanitizeValue(value)]),
  );
}

export function normalizeTags(
  tags: Record<string, PrimitiveTagValue> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!tags) {
    return undefined;
  }

  const nextTags = Object.fromEntries(
    Object.entries(tags)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [
        key,
        typeof value === "string" ? truncateString(value) : value,
      ]),
  ) as Record<string, string | number | boolean>;

  return Object.keys(nextTags).length > 0 ? nextTags : undefined;
}

export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === "string" ? error : "Unknown error");
}
