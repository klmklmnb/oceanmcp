import { API_URL } from "../../config";
import { RELEASE } from "./constants";
import { getHostLocation } from "./location";
import { sentryState } from "./state";

function getApiHost(): string {
  try {
    return new URL(API_URL).host;
  } catch {
    return "unknown";
  }
}

function getLocationTags(): Record<string, string> {
  const loc = getHostLocation();
  if (!loc) {
    return {};
  }

  const { origin, pathname } = loc;
  return {
    origin,
    href: `${origin}${pathname}`,
    pathname,
  };
}

export function getSdkTags(): Record<string, string | number | boolean> {
  return {
    ...getLocationTags(),
    ...sentryState.tags,
    sdk_version: __SDK_VERSION__,
    sdk_build: __SDK_BUILD__,
    api_host: getApiHost(),
  };
}

export function getSdkContext(): Record<string, unknown> {
  return {
    release: RELEASE,
    build: __SDK_BUILD__,
    apiHost: getApiHost(),
  };
}
