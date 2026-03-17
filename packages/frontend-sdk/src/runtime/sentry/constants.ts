export const MAX_STRING_LENGTH = 240;
export const MAX_ARRAY_LENGTH = 12;
export const MAX_OBJECT_KEYS = 20;
export const MAX_DEPTH = 4;

export const RELEASE = `@ocean-mcp/frontend-sdk@${__SDK_VERSION__}`;
export const SDK_CONTEXT_NAME = "ocean_mcp_sdk";

export const INTERNAL_SENTRY_DSN = "";
export const INTERNAL_SENTRY_TUNNEL = undefined;
export const SENTRY_BUNDLE_URL = "";
export const SENTRY_BUNDLE_INTEGRITY = "";

export const AUTO_DISABLED_INTEGRATIONS = new Set([
  "Breadcrumbs",
  "GlobalHandlers",
  "BrowserApiErrors",
  "BrowserSession"
]);
