export type PrimitiveTagValue = string | number | boolean | null | undefined;

export type SeverityLevel =
  | "fatal"
  | "error"
  | "warning"
  | "log"
  | "info"
  | "debug";

export type SdkScopeContext = {
  level?: SeverityLevel;
  tags?: Record<string, PrimitiveTagValue>;
  extras?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown> | null | undefined>;
  fingerprint?: string[];
};

export type SdkEventHint = Record<string, unknown> & {
  originalException?: unknown;
  captureContext?: SdkScopeContext;
};

export type SdkEvent = {
  message?: string;
  level?: SeverityLevel;
  tags?: Record<string, PrimitiveTagValue>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown> | null | undefined>;
  user?: Record<string, unknown>;
  request?: {
    method?: string;
    url?: string;
  };
  breadcrumbs?: Array<{
    message?: string;
    data?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

export type SentryBreadcrumb = {
  category?: string;
  level?: SeverityLevel;
  message?: string;
  data?: Record<string, unknown>;
};

export type SentryIntegration = {
  name?: string;
};

export type SentryScope = {
  setContext(name: string, context: Record<string, unknown> | null): void;
  setTags(tags: Record<string, string | number | boolean>): void;
  setExtras(extras: Record<string, unknown>): void;
  setLevel(level: SeverityLevel): void;
  setFingerprint(fingerprint: string[]): void;
};

export type SentryModule = {
  init(options: {
    dsn: string;
    release: string;
    environment: string;
    tunnel?: string;
    sendDefaultPii: boolean;
    maxBreadcrumbs: number;
    integrations?: unknown;
    beforeSend?: (event: SdkEvent) => SdkEvent | null;
  }): void;
  withScope<T>(callback: (scope: SentryScope) => T): T;
  captureException(error: Error, hint?: Record<string, unknown>): string | undefined;
  captureEvent(event: SdkEvent, hint?: Record<string, unknown>): string | undefined;
  addBreadcrumb(breadcrumb: SentryBreadcrumb): void;
  setContext(name: string, context: Record<string, unknown> | null): void;
  setTags(tags: Record<string, string | number | boolean>): void;
  setUser(user: Record<string, unknown> | null): void;
  getDefaultIntegrations(options: Record<string, unknown>): SentryIntegration[];
};

export type SdkSentryState = {
  current?: SentryModule;
  iframe?: HTMLIFrameElement;
  runningPromise?: Promise<SentryModule | undefined>;
  enabled: boolean;
  initialized: boolean;
  warnedMissingDsn: boolean;
  warnedInitFailure: boolean;
  tags: Record<string, string | number | boolean>;
};

export type OceanWindow = Window &
  typeof globalThis & {
    __OCEAN_MCP_SENTRY__?: SdkSentryState;
    Sentry?: SentryModule;
  };

export type RuntimeConfig = {
  dsn?: string;
  environment: string;
  tunnel?: string;
  integrations: unknown;
  bundleUrl: string;
  bundleIntegrity?: string;
};
