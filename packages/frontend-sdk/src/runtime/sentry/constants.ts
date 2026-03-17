export const MAX_STRING_LENGTH = 240;
export const MAX_ARRAY_LENGTH = 12;
export const MAX_OBJECT_KEYS = 20;
export const MAX_DEPTH = 4;

export const RELEASE = `@ocean-mcp/frontend-sdk@${__SDK_VERSION__}`;
export const SDK_CONTEXT_NAME = "ocean_mcp_sdk";

export const INTERNAL_SENTRY_DSN =
  "https://2dfc76dd404a460a95f7fb4e0f6eb161@ee-sentry.mihoyo.com/237";
export const INTERNAL_SENTRY_TUNNEL = undefined;
export const MIHOYO_SENTRY_BUNDLE_URL =
  "https://webstatic.mihoyo.com/neone-resources/scripts/sentry@8.13.0/bundle.min.js";
export const MIHOYO_SENTRY_BUNDLE_INTEGRITY =
  "sha384-h+Solusfc3gD6A4h0eF2N4kryfc8bDEcKr2iaiOCnWNLK/BeRIf4+XCcDaRiWcbd";

export const AUTO_DISABLED_INTEGRATIONS = new Set([
  "Breadcrumbs",
  "GlobalHandlers",
  "BrowserApiErrors",
  "BrowserSession",
]);
