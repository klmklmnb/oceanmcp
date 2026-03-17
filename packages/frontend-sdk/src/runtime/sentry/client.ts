import { RELEASE, SDK_CONTEXT_NAME } from "./constants";
import { getRuntimeConfig } from "./config";
import { sanitizeEvent } from "./event-sanitizer";
import { loadIframeSentry } from "./iframe-loader";
import { resolveIntegrations } from "./integrations";
import { getSdkContext, getSdkTags } from "./metadata";
import { isBrowserEnvironment, sentryState } from "./state";
import type { SentryModule } from "./types";

function warnMissingDsn(): void {
  if (import.meta.env.DEV && !sentryState.warnedMissingDsn) {
    sentryState.warnedMissingDsn = true;
    console.warn(
      "[OceanMCP] Built-in monitoring is disabled because the internal Sentry DSN is empty.",
    );
  }
}

function handleInitFailure(error: unknown): undefined {
  if (!sentryState.warnedInitFailure) {
    sentryState.warnedInitFailure = true;
    console.warn("[OceanMCP] Failed to initialize the built-in Sentry client.");
  }

  console.error(error);
  sentryState.enabled = false;
  return undefined;
}

export function initSentryBrowser(): Promise<SentryModule | undefined> {
  if (!isBrowserEnvironment()) {
    return Promise.resolve(undefined);
  }

  if (sentryState.current && sentryState.enabled) {
    return Promise.resolve(sentryState.current);
  }

  if (sentryState.runningPromise) {
    return sentryState.runningPromise;
  }

  const config = getRuntimeConfig();
  const dsn = config.dsn;
  if (!dsn) {
    sentryState.initialized = true;
    warnMissingDsn();
    return Promise.resolve(undefined);
  }

  sentryState.initialized = true;
  sentryState.runningPromise = loadIframeSentry(config)
    .then((Sentry) => {
      if (sentryState.current && sentryState.enabled) {
        return sentryState.current;
      }

      Sentry.init({
        dsn,
        release: RELEASE,
        environment: config.environment,
        tunnel: config.tunnel,
        sendDefaultPii: false,
        maxBreadcrumbs: 50,
        integrations: resolveIntegrations(Sentry, config.integrations),
        beforeSend: sanitizeEvent,
      });

      sentryState.current = Sentry;
      sentryState.enabled = true;
      Sentry.setUser(null);
      Sentry.setContext(SDK_CONTEXT_NAME, getSdkContext());
      Sentry.setTags(getSdkTags());
      Sentry.addBreadcrumb({
        category: "ocean-mcp",
        level: "info",
        message: "sdk.sentry_initialized",
        data: { build: __SDK_BUILD__, release: RELEASE },
      });

      return Sentry;
    })
    .catch(handleInitFailure)
    .finally(() => {
      sentryState.runningPromise = undefined;
    });

  return sentryState.runningPromise;
}

export function initSentryOnce(): Promise<SentryModule | undefined> {
  return initSentryBrowser();
}

export async function checkSentry(): Promise<SentryModule | undefined> {
  if (sentryState.current && sentryState.enabled) {
    return sentryState.current;
  }

  return initSentryBrowser();
}
