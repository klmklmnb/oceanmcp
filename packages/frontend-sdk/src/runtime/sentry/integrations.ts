import { AUTO_DISABLED_INTEGRATIONS } from "./constants";
import type { SentryModule } from "./types";

function getDefaultIntegrations(Sentry: SentryModule) {
  return Sentry.getDefaultIntegrations({}).filter(
    (integration) =>
      !integration.name || !AUTO_DISABLED_INTEGRATIONS.has(integration.name),
  );
}

export function resolveIntegrations(
  Sentry: SentryModule,
  integrations?: unknown,
): unknown {
  if (typeof integrations === "function") {
    return integrations(getDefaultIntegrations(Sentry));
  }

  return integrations ?? getDefaultIntegrations(Sentry);
}
