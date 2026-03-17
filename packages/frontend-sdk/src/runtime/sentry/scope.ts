import { SDK_CONTEXT_NAME } from "./constants";
import { getSdkContext, getSdkTags } from "./metadata";
import { normalizeTags, sanitizeRecord, sanitizeValue } from "./sanitize";
import type {
  SdkEventHint,
  SdkScopeContext,
  SentryScope,
} from "./types";

export function applyScopeContext(
  scope: SentryScope,
  context?: SdkScopeContext,
): void {
  scope.setContext(SDK_CONTEXT_NAME, getSdkContext());
  scope.setTags(getSdkTags());

  const tags = normalizeTags(context?.tags);
  if (tags) {
    scope.setTags(tags);
  }

  if (context?.extras) {
    scope.setExtras(sanitizeRecord(context.extras) ?? {});
  }

  for (const [key, value] of Object.entries(context?.contexts ?? {})) {
    scope.setContext(
      key,
      value ? (sanitizeValue(value) as Record<string, unknown>) : null,
    );
  }

  if (context?.level) {
    scope.setLevel(context.level);
  }

  if (context?.fingerprint?.length) {
    scope.setFingerprint(context.fingerprint);
  }
}

export function toNativeHint(
  hint?: SdkEventHint,
): Record<string, unknown> | undefined {
  if (!hint) {
    return undefined;
  }

  const { captureContext: _captureContext, ...nativeHint } = hint;
  return nativeHint;
}
