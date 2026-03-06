import { getSdkTags } from "./metadata";
import { normalizeTags, sanitizeRecord, truncateString } from "./sanitize";
import type { SdkEvent } from "./types";

export function sanitizeEvent<T extends SdkEvent>(event: T): T {
  const sanitized = { ...event };

  if (sanitized.user) {
    sanitized.user = {};
  }

  if (sanitized.request) {
    sanitized.request = {
      method: sanitized.request.method,
      url: sanitized.request.url,
    };
  }

  if (sanitized.extra) {
    sanitized.extra = sanitizeRecord(sanitized.extra) ?? {};
  }

  if (sanitized.contexts) {
    sanitized.contexts = sanitizeRecord(sanitized.contexts) as T["contexts"];
  }

  if (sanitized.breadcrumbs) {
    sanitized.breadcrumbs = sanitized.breadcrumbs.map((breadcrumb) => ({
      ...breadcrumb,
      message:
        typeof breadcrumb.message === "string"
          ? truncateString(breadcrumb.message)
          : breadcrumb.message,
      data: sanitizeRecord(breadcrumb.data),
    }));
  }

  sanitized.tags = {
    ...getSdkTags(),
    ...(normalizeTags(sanitized.tags) ?? {}),
  };

  return sanitized;
}
