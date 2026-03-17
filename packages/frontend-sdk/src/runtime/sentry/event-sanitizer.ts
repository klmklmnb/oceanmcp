import { getSdkTags } from "./metadata";
import { getHostLocation, isIframePlaceholderUrl } from "./location";
import { normalizeTags, sanitizeRecord, truncateString } from "./sanitize";
import type { SdkEvent } from "./types";

function getHostPageUrl(): string | undefined {
  return getHostLocation()?.href;
}

export function sanitizeEvent(event: SdkEvent): SdkEvent | null {
  const sanitized = { ...event };

  if (sanitized.user) {
    sanitized.user = {};
  }

  const hostUrl = getHostPageUrl();
  if (hostUrl && isIframePlaceholderUrl(sanitized.request?.url)) {
    sanitized.request = {
      ...sanitized.request,
      url: hostUrl,
    };
  } else if (sanitized.request) {
    sanitized.request = {
      method: sanitized.request.method,
      url: sanitized.request.url,
    };
  }

  if (hostUrl) {
    if (
      !sanitized.transaction ||
      sanitized.transaction === "about:blank" ||
      sanitized.transaction === "/"
    ) {
      try {
        sanitized.transaction = new URL(hostUrl).pathname;
      } catch {
        // keep existing value
      }
    }
  }

  if (sanitized.extra) {
    sanitized.extra = sanitizeRecord(sanitized.extra) ?? {};
  }

  if (sanitized.contexts) {
    sanitized.contexts = sanitizeRecord(sanitized.contexts) as SdkEvent["contexts"];
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
