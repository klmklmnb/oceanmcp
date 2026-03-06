import { checkSentry } from "./client";
import { getSdkTags } from "./metadata";
import { normalizeTags, sanitizeRecord, toError } from "./sanitize";
import { applyScopeContext, toNativeHint } from "./scope";
import { sentryState } from "./state";
import type {
  PrimitiveTagValue,
  SdkEvent,
  SdkEventHint,
  SdkScopeContext,
  SentryModule,
  SentryScope,
  SeverityLevel,
} from "./types";

export function setSdkTags(tags: Record<string, PrimitiveTagValue>): void {
  const normalizedTags = normalizeTags(tags);
  if (!normalizedTags) {
    return;
  }

  sentryState.tags = { ...sentryState.tags, ...normalizedTags };
  void checkSentry().then((Sentry) => {
    if (Sentry && sentryState.enabled) {
      Sentry.setTags(normalizedTags);
    }
  });
}

export function addSdkBreadcrumb(
  name: string,
  data?: Record<string, unknown>,
  level: SeverityLevel = "info",
): void {
  const breadcrumbData = sanitizeRecord(data);
  void checkSentry().then((Sentry) => {
    if (!Sentry || !sentryState.enabled) {
      return;
    }

    Sentry.addBreadcrumb({
      category: "ocean-mcp",
      level,
      message: name,
      data: breadcrumbData,
    });
  });
}

async function withSdkScope<T>(
  context: SdkScopeContext | undefined,
  callback: (scope: SentryScope, Sentry: SentryModule) => T,
): Promise<T | undefined> {
  const Sentry = await checkSentry();
  if (!Sentry || !sentryState.enabled) {
    return undefined;
  }

  return Sentry.withScope((scope) => {
    applyScopeContext(scope, context);
    return callback(scope, Sentry);
  });
}

async function reportError(
  error: unknown,
  hint?: SdkEventHint,
): Promise<string | undefined> {
  return withSdkScope(hint?.captureContext, (_scope, Sentry) =>
    Sentry.captureException(toError(error), {
      ...toNativeHint(hint),
      originalException: hint?.originalException ?? error,
    }),
  );
}

async function reportEvent(
  event: SdkEvent,
  hint?: SdkEventHint,
): Promise<string | undefined> {
  return withSdkScope(hint?.captureContext, (_scope, Sentry) =>
    Sentry.captureEvent(
      {
        ...event,
        level: event.level ?? "info",
        extra: sanitizeRecord(event.extra) ?? event.extra,
        contexts: sanitizeRecord(event.contexts) as SdkEvent["contexts"],
        tags: { ...getSdkTags(), ...(normalizeTags(event.tags) ?? {}) },
      },
      toNativeHint(hint),
    ),
  );
}

export function captureException(
  error: unknown,
  context?: SdkScopeContext,
): void {
  void reportError(error, {
    captureContext: context,
    originalException: error,
  });
}

export function captureSdkEvent(
  name: string,
  options?: {
    data?: Record<string, unknown>;
    tags?: Record<string, PrimitiveTagValue>;
    level?: SeverityLevel;
  },
): void {
  const level = options?.level ?? "info";
  void reportEvent(
    {
      message: name,
      level,
      extra: options?.data,
      tags: {
        sdk_event: name,
        ...(options?.tags ?? {}),
      },
    },
    {
      captureContext: {
        fingerprint: ["sdk_event", name],
        level,
      },
    },
  );
}
