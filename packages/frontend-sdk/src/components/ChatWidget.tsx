import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  MESSAGE_PART_TYPE,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TOOL_PART_TYPE_PREFIX,
  type FileAttachment,
} from "@ocean-mcp/shared";
import { MessageRenderer } from "./MessageRenderer";
import { wsClient } from "../runtime/ws-client";
import { chatBridge } from "../runtime/chat-bridge";
import { uploadRegistry } from "../runtime/upload-registry";
import {
  addSdkBreadcrumb,
  captureException,
  setSdkTags,
} from "../runtime/sentry";
import { sdkConfig, resolveTheme, LOCALE_CHANGE_EVENT, THEME_CHANGE_EVENT, THEME, type Theme, type SupportedLocale } from "../runtime/sdk-config";
import { getActiveShadowRoot } from "../shadow-dom";
import { t } from "../locale";
import { CHAT_STATUS } from "../constants/chat";
import { API_URL } from "../config";
import {
  commandRegistry,
  parseSlashCommand,
  type SlashCommand,
} from "../command/command-registry";
import { OPEN_SESSIONS_EVENT } from "../command/builtin-commands";
import { sessionManager } from "../session/session-manager";
import {
  DEFAULT_SESSION_TITLE,
  LEGACY_ZH_DEFAULT_SESSION_TITLE,
  TITLE_GENERATION_PENDING,
  TITLE_MAX_LENGTH,
  type SessionMeta,
} from "../session/session-adapter";
import { CommandPalette } from "./CommandPalette";
import { SessionList } from "./SessionList";

const AUTO_DENY_REASON =
  "User sent a new message instead of responding to approval";

type PendingFile = {
  id: string;
  file: File;
  status: "uploading" | "ready" | "error";
  attachment?: FileAttachment;
  error?: string;
};

function isDefaultSessionTitle(title?: string): boolean {
  const normalized = title?.trim();
  if (!normalized) return true;
  return (
    normalized === DEFAULT_SESSION_TITLE ||
    normalized === LEGACY_ZH_DEFAULT_SESSION_TITLE
  );
}

function deriveFirstUserFallbackTitle(messages: any[]): string | null {
  if (!Array.isArray(messages)) return null;
  for (const message of messages) {
    if (message?.role !== MESSAGE_ROLE.USER || !Array.isArray(message.parts)) {
      continue;
    }
    const text = message.parts
      .filter((part: any) => part?.type === MESSAGE_PART_TYPE.TEXT)
      .map((part: any) => part.text)
      .join("")
      .trim();
    if (!text) continue;
    return text.slice(0, TITLE_MAX_LENGTH);
  }
  return null;
}

function shouldSkipAiTitleGeneration(
  title: string | undefined,
  fallbackTitle: string | null,
): boolean {
  const normalized = title?.trim();
  if (!normalized) return false;
  if (isDefaultSessionTitle(normalized)) return false;
  if (fallbackTitle && normalized === fallbackTitle) return false;
  return true;
}

function shouldGenerateAiTitle(meta?: SessionMeta): boolean {
  return meta?.titleGenerationState === TITLE_GENERATION_PENDING;
}

function isToolPart(part: any): boolean {
  return (
    typeof part?.type === "string" &&
    part.type.startsWith(TOOL_PART_TYPE_PREFIX)
  );
}

function getToolName(part: any): string {
  if (
    typeof part?.type === "string" &&
    part.type.startsWith(TOOL_PART_TYPE_PREFIX)
  ) {
    return part.type.slice(TOOL_PART_TYPE_PREFIX.length);
  }
  return part?.toolName || "unknown";
}

function shouldAutoDeny(part: any): boolean {
  return (
    isToolPart(part) &&
    (part.state === TOOL_PART_STATE.APPROVAL_REQUESTED ||
      (part.state === TOOL_PART_STATE.APPROVAL_RESPONDED &&
        part.approval?.approved === false))
  );
}

function isPendingAskUser(part: any): boolean {
  return (
    isToolPart(part) &&
    getToolName(part) === "askUser" &&
    part.state === TOOL_PART_STATE.INPUT_AVAILABLE
  );
}

/**
 * Pure-logic helper extracted from the `sendAutomaticallyWhen` callback so
 * it can be unit-tested without rendering the ChatWidget component.
 *
 * Returns `{ decision, approvalIds, askUserIds }` where:
 *   - `decision` — whether `useChat` should automatically send a new request
 *   - `approvalIds` — approval IDs that should be marked as submitted
 *   - `askUserIds` — askUser toolCallIds that should be marked as submitted
 */
export function evaluateSendAutomatically(
  messages: any[],
  submittedApprovalIds: Set<string>,
  submittedAskUserIds: Set<string>,
): { decision: boolean; approvalIds: string[]; askUserIds: string[] } {
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== MESSAGE_ROLE.ASSISTANT) {
    return { decision: false, approvalIds: [], askUserIds: [] };
  }

  const toolParts = (lastMsg.parts || []).filter(isToolPart);

  const approvalRespondedParts = toolParts.filter((part: any) => {
    return (
      part.state === TOOL_PART_STATE.APPROVAL_RESPONDED &&
      part.approval?.approved != null &&
      !submittedApprovalIds.has(part.approval?.id)
    );
  });

  const hasAnyApprovalResponse = approvalRespondedParts.length > 0;

  const allToolPartsSettled = toolParts.every((part: any) => {
    return (
      part.state === TOOL_PART_STATE.OUTPUT_AVAILABLE ||
      part.state === TOOL_PART_STATE.OUTPUT_ERROR ||
      part.state === TOOL_PART_STATE.APPROVAL_RESPONDED ||
      part.state === TOOL_PART_STATE.OUTPUT_DENIED ||
      // APPROVAL_REQUESTED and INPUT_AVAILABLE are "settled enough"
      // for auto-send purposes — the stream has ended and these parts
      // will be resolved by their own interaction flows (approval
      // buttons / askUser cards). Without this, a resolved
      // askUser sitting next to an unresolved approval (or vice
      // versa) would block the auto-send indefinitely.
      part.state === TOOL_PART_STATE.APPROVAL_REQUESTED ||
      part.state === TOOL_PART_STATE.INPUT_AVAILABLE
    );
  });

  const settledAskUserParts = toolParts.filter((part: any) => {
    if (getToolName(part) !== "askUser") return false;
    if (!part.toolCallId) return false;
    if (submittedAskUserIds.has(part.toolCallId)) return false;
    return (
      part.state === TOOL_PART_STATE.OUTPUT_AVAILABLE ||
      part.state === TOOL_PART_STATE.OUTPUT_ERROR
    );
  });

  const hasAskUserResult = settledAskUserParts.length > 0;

  const decision = Boolean(
    allToolPartsSettled && (hasAnyApprovalResponse || hasAskUserResult),
  );

  const approvalIds = decision
    ? approvalRespondedParts
        .map((p: any) => p.approval?.id)
        .filter(Boolean) as string[]
    : [];
  const askUserIds = decision
    ? settledAskUserParts
        .map((p: any) => p.toolCallId)
        .filter(Boolean) as string[]
    : [];

  return { decision, approvalIds, askUserIds };
}

/**
 * Apply the `dark` class on the shadow host element so that the
 * `:host(.dark)` selector fires.  This is necessary because Tailwind's
 * `@theme` variables (e.g. `--color-surface-secondary`) are defined on
 * `:host` via `var(--ui-…)` references.  The browser resolves those
 * references at computed-value time *on the host element*, so overriding
 * `--ui-…` on a descendant `.dark` div has no effect on the already-
 * resolved `--color-…` values.  Toggling the class directly on the host
 * ensures `--ui-…` values are dark *before* `--color-…` variables are
 * resolved.
 */
function applyShadowHostTheme(theme: "light" | "dark") {
  const shadowRoot = getActiveShadowRoot();
  const host = shadowRoot?.host;
  if (!host) return;
  host.classList.toggle(THEME.DARK, theme === THEME.DARK);
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => resolveTheme(sdkConfig.theme));

  useEffect(() => {
    const apply = (t: "light" | "dark") => {
      setTheme(t);
      applyShadowHostTheme(t);
    };

    apply(resolveTheme(sdkConfig.theme));

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onMediaChange = () => apply(resolveTheme(sdkConfig.theme));
    mediaQuery.addEventListener("change", onMediaChange);

    const onConfigChange = (e: Event) => {
      const detail = (e as CustomEvent<Theme | undefined>).detail;
      apply(resolveTheme(detail));
    };
    window.addEventListener(THEME_CHANGE_EVENT, onConfigChange);

    return () => {
      mediaQuery.removeEventListener("change", onMediaChange);
      window.removeEventListener(THEME_CHANGE_EVENT, onConfigChange);
    };
  }, []);

  return theme;
}

function useLocale(): SupportedLocale {
  const [locale, setLocale] = useState<SupportedLocale>(sdkConfig.locale ?? "zh-CN");

  useEffect(() => {
    const onLocaleChange = (e: Event) => {
      const detail = (e as CustomEvent<SupportedLocale | undefined>).detail;
      setLocale(detail ?? "zh-CN");
    };
    window.addEventListener(LOCALE_CHANGE_EVENT, onLocaleChange);
    return () => window.removeEventListener(LOCALE_CHANGE_EVENT, onLocaleChange);
  }, []);

  return locale;
}

const USER_SELECT_DENY_REASON =
  "User sent a new message instead of responding to selection";

function denyPendingInteractions(messages: any[]): {
  messages: any[];
  changed: boolean;
} {
  let changed = false;

  const nextMessages = messages.map((message, index) => {
    if (
      message.role !== MESSAGE_ROLE.ASSISTANT ||
      !Array.isArray(message.parts)
    ) {
      return message;
    }

    let messageChanged = false;
    const nextParts = message.parts.map((part: any) => {
      // Handle pending approval parts (existing behavior)
      if (shouldAutoDeny(part)) {
        messageChanged = true;
        changed = true;

        return {
          ...part,
          state: TOOL_PART_STATE.OUTPUT_DENIED,
          approval: {
            id: part.approval?.id ?? `auto-deny-${part.toolCallId ?? index}`,
            approved: false,
            reason: part.approval?.reason ?? AUTO_DENY_REASON,
          },
        };
      }

      // Handle pending askUser parts
      if (isPendingAskUser(part)) {
        messageChanged = true;
        changed = true;

        return {
          ...part,
          state: TOOL_PART_STATE.OUTPUT_DENIED,
          output: { denied: true, reason: USER_SELECT_DENY_REASON },
          // AI SDK v6 unconditionally reads `approval.reason` when
          // converting OUTPUT_DENIED parts to model messages, so we
          // must provide an approval object even for askUser parts.
          approval: {
            id: `auto-deny-select-${part.toolCallId ?? index}`,
            approved: false,
            reason: USER_SELECT_DENY_REASON,
          },
        };
      }

      return part;
    });

    return messageChanged ? { ...message, parts: nextParts } : message;
  });

  return { messages: nextMessages, changed };
}

/** Send icon */
function SendIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

/** Stop icon (square — standard "stop generating" symbol) */
function StopIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** Paperclip icon for upload */
function AttachIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

/** Session/history icon */
function SessionIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 3 3 9 9 9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

/**
 * Main Chat Widget component.
 * Uses Vercel AI SDK's `useChat` with `fetch`-based transport to connect
 * to the api-server's /api/chat endpoint.
 */
export function ChatWidget({ avatar }: { avatar?: string }) {
  const sessionsEnabled = sdkConfig.session?.enable === true;
  const showSessionBottomEntry =
    sessionsEnabled && sdkConfig.session?.showBottomEntryButton !== false;
  const currentLocale = useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Whether the scroll container is currently at (or near) the bottom. */
  const isAtBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [commandRegistryVersion, setCommandRegistryVersion] = useState(0);
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
  const [sessionMetas, setSessionMetas] = useState<SessionMeta[]>([]);
  const [showSessionList, setShowSessionList] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const dragCounterRef = useRef(0);
  /** Track approval IDs that have already triggered an auto-submit to prevent re-sends. */
  const submittedApprovalIdsRef = useRef<Set<string>>(new Set());
  /** Track askUser toolCallIds that have already triggered an auto-submit to prevent re-sends. */
  const submittedAskUserIdsRef = useRef<Set<string>>(new Set());
  const lastCapturedChatErrorRef = useRef<unknown>(null);

  const welcomeTitle = sdkConfig.welcomeTitle ?? t("chat.welcome.title");
  const welcomeDescription = sdkConfig.welcomeDescription ?? t("chat.welcome.description");
  const suggestions = sdkConfig.suggestions ?? [
    t("chat.welcome.suggestion1"),
    t("chat.welcome.suggestion2"),
    t("chat.welcome.suggestion3"),
  ];
  const parsedSlashInput = useMemo(() => parseSlashCommand(input), [input]);
  const slashCommands = useMemo(() => {
    if (!parsedSlashInput) return [];
    return commandRegistry.search(parsedSlashInput.name);
  }, [parsedSlashInput, commandRegistryVersion]);
  const showCommandPalette = Boolean(
    parsedSlashInput &&
      !parsedSlashInput.args &&
      input.trim().startsWith("/") &&
      slashCommands.length > 0,
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_URL}/api/chat`,
        body: () => {
          const subagent = sdkConfig.subagent;
          return {
            connectionId: wsClient.currentConnectionId ?? undefined,
            modelConfig: sdkConfig.model ?? undefined,
            toolRetries: sdkConfig.toolRetries ?? undefined,
            subagentEnabled: subagent?.enable ?? undefined,
            subagentModel: subagent?.enable
              ? (subagent.model ?? sdkConfig.model ?? undefined)
              : undefined,
            subagentTimeoutMs: subagent?.enable && subagent.timeoutSeconds != null
              ? subagent.timeoutSeconds * 1000
              : undefined,
            subagentMaxParallel: subagent?.enable && subagent.maxParallel != null
              ? subagent.maxParallel
              : undefined,
            uploaderRegistered: uploadRegistry.isRegistered,
          };
        },
      }),
    [],
  );

  const sendAutomaticallyWhen = useCallback(
    ({ messages: msgs }: { messages: any[] }) => {
      const { decision, approvalIds, askUserIds } =
        evaluateSendAutomatically(
          msgs,
          submittedApprovalIdsRef.current,
          submittedAskUserIdsRef.current,
        );

      if (decision) {
        console.log(
          "[OceanMCP] sendAutomaticallyWhen → true",
          { approvalCount: approvalIds.length, askUserCount: askUserIds.length },
        );
        for (const id of approvalIds) {
          submittedApprovalIdsRef.current.add(id);
        }
        for (const id of askUserIds) {
          submittedAskUserIdsRef.current.add(id);
        }
      }

      return decision;
    },
    [],
  );

  const {
    messages,
    setMessages,
    status,
    error,
    stop,
    addToolResult,
    addToolApprovalResponse,
    sendMessage,
  } = useChat({ transport, sendAutomaticallyWhen });

  const messagesRef = useRef<any[]>(messages as any[]);
  useEffect(() => {
    messagesRef.current = messages as any[];
  }, [messages]);

  const refreshSessionMetas = useCallback(async () => {
    if (!sessionsEnabled) return;
    const metas = await sessionManager.listSessions();
    setSessionMetas(metas);
    setCurrentSessionId(sessionManager.activeSessionId);
  }, [sessionsEnabled]);

  const runSlashCommand = useCallback(
    async (command: SlashCommand, args?: string) => {
      setCommandSelectedIndex(0);
      try {
        await command.execute(args);
        setInput("");
        setPendingFiles([]);
        await refreshSessionMetas();
      } catch (error) {
        captureException(error, {
          tags: {
            stage: "slash_command_execute",
          },
          extras: {
            command: command.name,
          },
        });
      }
    },
    [refreshSessionMetas],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    if (!value.trim().startsWith("/")) {
      setCommandSelectedIndex(0);
    }
  };

  const sendUserText = async (text: string) => {
    if (!text.trim()) return;
    setStopRequested(false);

    const normalized = denyPendingInteractions(messages as any[]);
    if (normalized.changed) {
      // Only update visual state here. The server-side
      // normalizeStaleInteractions converts stale askUser / approval
      // parts into OUTPUT_DENIED with a proper tool result before the
      // next LLM call, so we do NOT call addToolResult for auto-denied
      // selects (doing so would set the state to output-available and
      // cause "已选择: undefined" rendering).
      setMessages(normalized.messages as any);
    }

    addSdkBreadcrumb("chat.send_programmatic", {
      partCount: 1,
      hasText: true,
      fileCount: 0,
    });

    // Programmatic send — follow the response by scrolling
    isAtBottomRef.current = true;

    await sendMessage({
      role: MESSAGE_ROLE.USER,
      parts: [{ type: MESSAGE_PART_TYPE.TEXT, text }],
    });
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    const hasText = input.trim();
    const readyFiles = pendingFiles.filter((f) => f.status === "ready");

    if (!hasText && readyFiles.length === 0) return;

    const parsed = parseSlashCommand(input);
    if (parsed && readyFiles.length === 0) {
      const command = commandRegistry.get(parsed.name);
      if (command) {
        await runSlashCommand(command, parsed.args);
        return;
      }
    }

    setStopRequested(false);

    const value = input;
    setInput("");
    setPendingFiles([]);

    const normalized = denyPendingInteractions(messages as any[]);
    if (normalized.changed) {
      setMessages(normalized.messages as any);
    }

    const parts: any[] = [];
    
    if (hasText) {
      parts.push({ type: MESSAGE_PART_TYPE.TEXT, text: value });
    }
    
    if (readyFiles.length > 0) {
      parts.push({
        type: MESSAGE_PART_TYPE.FILE_ATTACHMENT,
        data: readyFiles.map((f) => f.attachment!),
      });
    }

    const submitData = {
      partCount: parts.length,
      hasText: Boolean(hasText),
      fileCount: readyFiles.length,
    };
    addSdkBreadcrumb("chat.submit", submitData);

    // User just sent a message — follow the response by scrolling
    isAtBottomRef.current = true;

    await sendMessage({
      role: MESSAGE_ROLE.USER,
      parts,
    });
  };

  // Track whether the user has scrolled away from the bottom.
  // When near the bottom, auto-scroll continues; when the user scrolls up,
  // auto-scroll is suppressed until they scroll back down.
  const SCROLL_BOTTOM_THRESHOLD = 40; // px tolerance

  const handleScrollContainer = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
  }, []);

  // Auto-scroll to bottom on new messages — only when already at the bottom
  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSdkTags({
      locale: currentLocale,
    });
  }, [currentLocale]);

  useEffect(() => {
    if (!error || lastCapturedChatErrorRef.current === error) {
      return;
    }

    lastCapturedChatErrorRef.current = error;
    captureException(error, {
      tags: {
        stage: "chat_transport",
      },
      extras: {
        status,
        messageCount: messages.length,
      },
    });
  }, [error, messages.length, status]);

  useEffect(() => {
    if (status !== CHAT_STATUS.STREAMING && status !== CHAT_STATUS.SUBMITTED) {
      setStopRequested(false);
    }
  }, [status]);

  useEffect(() => {
    return commandRegistry.subscribe(() => {
      setCommandRegistryVersion((prev) => prev + 1);
    });
  }, []);

  useEffect(() => {
    if (!showCommandPalette) {
      setCommandSelectedIndex(0);
      return;
    }
    if (commandSelectedIndex >= slashCommands.length) {
      setCommandSelectedIndex(0);
    }
  }, [commandSelectedIndex, slashCommands.length, showCommandPalette]);

  useEffect(() => {
    if (!sessionsEnabled) return;
    const unsubscribe = sessionManager.subscribe((id) => {
      setCurrentSessionId(id);
    });
    return unsubscribe;
  }, [sessionsEnabled]);

  useEffect(() => {
    if (!sessionsEnabled) return;
    const handler = () => {
      setShowSessionList(true);
      void refreshSessionMetas();
    };
    window.addEventListener(OPEN_SESSIONS_EVENT, handler);
    return () => window.removeEventListener(OPEN_SESSIONS_EVENT, handler);
  }, [refreshSessionMetas, sessionsEnabled]);

  useEffect(() => {
    if (!sessionsEnabled || !bridgeReady) return;

    let cancelled = false;
    const bootstrap = async () => {
      try {
        await sessionManager.initialize();
        if (!cancelled) {
          await refreshSessionMetas();
        }
      } catch (error) {
        captureException(error, {
          tags: {
            stage: "session_initialize",
          },
        });
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [bridgeReady, refreshSessionMetas, sessionsEnabled]);

  useEffect(() => {
    if (!sessionsEnabled) return;
    const sessionIdForEffect = currentSessionId;

    const timer = window.setTimeout(() => {
      sessionManager.saveCurrentSession(
        messages as any[],
        sessionIdForEffect,
      ).catch((error) => {
        captureException(error, {
          tags: {
            stage: "session_autosave",
          },
        });
      });
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [currentSessionId, messages, sessionsEnabled]);

  // Generate AI title after first assistant response completes
  const titleGeneratedSessions = useRef(new Set<string>());
  const titleGeneratingSessions = useRef(new Set<string>());
  useEffect(() => {
    if (!sessionsEnabled || !currentSessionId) return;
    if (status === "streaming" || status === "submitted") return;
    if (titleGeneratedSessions.current.has(currentSessionId)) return;
    if (titleGeneratingSessions.current.has(currentSessionId)) return;
    const currentMeta = sessionMetas.find((meta) => meta.id === currentSessionId);

    const hasUserMsg = messages.some((m: any) => m.role === MESSAGE_ROLE.USER);
    const hasAssistantMsg = messages.some(
      (m: any) => m.role === MESSAGE_ROLE.ASSISTANT,
    );
    if (!hasUserMsg || !hasAssistantMsg) return;
    const fallbackTitle = deriveFirstUserFallbackTitle(messages as any[]);

    const sessionId = currentSessionId;

    const lightweight = messages
      .slice(0, 2)
      .map((m: any) => ({
        role: m.role,
        text: (
          m.parts
            ?.filter((p: any) => p.type === MESSAGE_PART_TYPE.TEXT)
            .map((p: any) => p.text)
            .join("") ?? ""
        ).slice(0, 500),
      }))
      .filter((m: { text: string }) => m.text);

    if (lightweight.length === 0) return;

    titleGeneratingSessions.current.add(sessionId);
    const controller = new AbortController();
    const generateTitleIfDefault = async () => {
      let persistedMeta = currentMeta;
      if (!persistedMeta) {
        const metas = await sessionManager.listSessions();
        persistedMeta = metas.find((meta) => meta.id === sessionId);
      }
      if (!persistedMeta) return;
      if (
        !shouldGenerateAiTitle(persistedMeta)
      ) {
        titleGeneratedSessions.current.add(sessionId);
        return;
      }
      if (shouldSkipAiTitleGeneration(persistedMeta.title, fallbackTitle)
      ) {
        await sessionManager.markSessionTitleGenerationCompleted(sessionId);
        titleGeneratedSessions.current.add(sessionId);
        await refreshSessionMetas();
        return;
      }

      const response = await fetch(`${API_URL}/api/generate-title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: lightweight }),
        signal: controller.signal,
      });
      if (!response.ok) return;
      const data = await response.json();
      if (!data?.title) return;

      const latestMetas = await sessionManager.listSessions();
      const latestMeta = latestMetas.find((meta) => meta.id === sessionId);
      if (!latestMeta) return;
      if (!shouldGenerateAiTitle(latestMeta)) {
        titleGeneratedSessions.current.add(sessionId);
        return;
      }
      if (shouldSkipAiTitleGeneration(latestMeta.title, fallbackTitle)) {
        await sessionManager.markSessionTitleGenerationCompleted(sessionId);
        titleGeneratedSessions.current.add(sessionId);
        await refreshSessionMetas();
        return;
      }

      await sessionManager.updateSessionTitle(sessionId, data.title);
      titleGeneratedSessions.current.add(sessionId);
      await refreshSessionMetas();
    };

    void generateTitleIfDefault()
      .catch(() => {})
      .finally(() => {
        titleGeneratingSessions.current.delete(sessionId);
      });

    return () => controller.abort();
  }, [
    currentSessionId,
    messages,
    refreshSessionMetas,
    sessionMetas,
    sessionsEnabled,
    status,
  ]);

  const handleCreateSession = useCallback(async () => {
    try {
      await sessionManager.createNewSession();
      await refreshSessionMetas();
      setShowSessionList(false);
    } catch (error) {
      captureException(error, {
        tags: {
          stage: "session_create",
        },
      });
    }
  }, [refreshSessionMetas]);

  const handleSwitchSession = useCallback(
    async (sessionId: string) => {
      try {
        await sessionManager.switchSession(sessionId);
        await refreshSessionMetas();
        setShowSessionList(false);
        window.setTimeout(() => {
          inputRef.current?.focus();
        }, 0);
      } catch (error) {
        captureException(error, {
          tags: {
            stage: "session_switch",
          },
          extras: {
            sessionId,
          },
        });
      }
    },
    [refreshSessionMetas],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (!window.confirm(t("chat.session.deleteConfirm"))) {
        return;
      }
      try {
        await sessionManager.deleteSession(sessionId);
        await refreshSessionMetas();
      } catch (error) {
        captureException(error, {
          tags: {
            stage: "session_delete",
          },
          extras: {
            sessionId,
          },
        });
      }
    },
    [refreshSessionMetas],
  );

  // ─── Upload ──────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;

    const newPending: PendingFile[] = files.map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      status: "uploading",
    }));

    setPendingFiles((prev) => [...prev, ...newPending]);

    try {
      const results = await uploadRegistry.upload(files);

      setPendingFiles((prev) =>
        prev.map((pf) => {
          const idx = newPending.findIndex((np) => np.id === pf.id);
          if (idx === -1) return pf;

          const result = results[idx];
          const { url, name, size, type, ...rest } = result;
          const attachment: FileAttachment = {
            url,
            name: name ?? pf.file.name,
            size: size ?? pf.file.size,
            mimeType: type ?? (pf.file.type || "application/octet-stream"),
          };
          if (Object.keys(rest).length > 0) {
            attachment.metadata = rest;
          }

          return { ...pf, status: "ready", attachment };
        })
      );
    } catch (err: any) {
      console.error("[OceanMCP] Upload failed:", err);
      captureException(err, {
        tags: {
          stage: "upload",
        },
        extras: {
          fileCount: files.length,
          mimeTypes: [...new Set(files.map((file) => file.type || "unknown"))],
          totalBytes: files.reduce((sum, file) => sum + file.size, 0),
        },
      });
      setPendingFiles((prev) =>
        prev.map((pf) =>
          newPending.some((np) => np.id === pf.id)
            ? { ...pf, status: "error", error: err.message || "Upload failed" }
            : pf
        )
      );
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    await processFiles(files);
  };

  const removeFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // ─── Drag and Drop ───────────────────────────────────────────────────────
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!uploadRegistry.isRegistered) return;
    
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    dragCounterRef.current = 0;
    setIsDragging(false);
    
    if (!uploadRegistry.isRegistered) return;
    
    const files = Array.from(e.dataTransfer.files);
    await processFiles(files);
  };

  // Bridge: expose widget capabilities to OceanMCPSDK.*() methods
  const sendUserTextRef = useRef(sendUserText);
  sendUserTextRef.current = sendUserText;
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const handleStop = useCallback(() => {
    setStopRequested(true);
    stopRef.current();
  }, []);

  useEffect(() => {
    chatBridge.register("chat", async (text: string) => {
      setInput(text);
      await new Promise((r) => setTimeout(r, 80));
      setInput("");
      await sendUserTextRef.current(text);
    });

    chatBridge.register("setInput", (text: string) => {
      setInput(text);
    });

    chatBridge.register("getMessages", () => messagesRef.current);

    chatBridge.register("loadSession", (nextMessages: any[]) => {
      setMessages(Array.isArray(nextMessages) ? nextMessages : []);
    });

    chatBridge.register("clearMessages", () => {
      setMessages([]);
    });

    chatBridge.register("stop", () => {
      handleStop();
    });

    setBridgeReady(true);
    return () => {
      setBridgeReady(false);
      chatBridge.unregisterAll();
    };
  }, [handleStop]);

  /**
   * AI SDK v6 approval flow:
   * - For tools with `needsApproval: true`, use `addToolApprovalResponse`
   *   with the approval `id` from the tool part's `approval` object.
   * - For client-side tools needing output, use `addToolResult` / `addToolOutput`.
   *
   * The `approvalId` is passed from the ApprovalButtons component (extracted
   * from `part.approval.id` in the MessageRenderer).
   */
  const handleApprove = (
    toolCallId: string,
    toolName: string,
    approvalId?: string,
  ) => {
    const approvalData = {
      toolName,
      toolCallId,
      hasApprovalId: Boolean(approvalId),
    };
    addSdkBreadcrumb("tool.approve", approvalData);

    if (approvalId) {
      // AI SDK v6: use addToolApprovalResponse for needsApproval tools
      addToolApprovalResponse({
        id: approvalId,
        approved: true,
      });
    } else {
      // Fallback for tools without approval flow
      addToolResult({
        toolCallId,
        tool: toolName,
        output: "User approved the action",
      });
    }
  };

  const handleDeny = (
    toolCallId: string,
    toolName: string,
    approvalId?: string,
  ) => {
    const denyData = {
      toolName,
      toolCallId,
      hasApprovalId: Boolean(approvalId),
    };
    addSdkBreadcrumb("tool.deny", denyData);

    if (approvalId) {
      // AI SDK v6: use addToolApprovalResponse for needsApproval tools
      addToolApprovalResponse({
        id: approvalId,
        approved: false,
        reason: "User denied the action",
      });
    } else {
      addToolResult({
        toolCallId,
        tool: toolName,
        output: "User denied the action",
      });
    }
  };

  const handleUserSelect = (toolCallId: string, output: Record<string, any>) => {
    addToolResult({
      toolCallId,
      tool: "askUser",
      output,
    });
  };

  const handleDenySelect = (toolCallId: string) => {
    addToolResult({
      toolCallId,
      tool: "askUser",
      output: { denied: true, reason: "User denied the selection" },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommandPalette) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCommandSelectedIndex((prev) =>
          prev + 1 >= slashCommands.length ? 0 : prev + 1,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCommandSelectedIndex((prev) =>
          prev - 1 < 0 ? slashCommands.length - 1 : prev - 1,
        );
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        setCommandSelectedIndex(0);
        return;
      }
      if (
        (e.key === "Enter" || e.key === "Tab") &&
        !e.shiftKey &&
        !e.repeat &&
        !e.nativeEvent.isComposing
      ) {
        e.preventDefault();
        const selected = slashCommands[commandSelectedIndex] ?? slashCommands[0];
        if (selected) {
          void runSlashCommand(selected);
        }
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !e.repeat && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  const isStreaming = status === CHAT_STATUS.STREAMING;
  const isLoading = status === CHAT_STATUS.SUBMITTED;
  const isResponseActive = (isStreaming || isLoading) && !stopRequested;
  const currentTheme = useTheme();
  const lastMessageId = messages[messages.length - 1]?.id;

  useEffect(() => {
    setSdkTags({
      theme: currentTheme,
    });
  }, [currentTheme]);

  return (
    <div 
      className={`flex flex-col h-full bg-surface-secondary relative ${currentTheme === THEME.DARK ? THEME.DARK : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Messages area */}
      <div
        ref={scrollRef}
        onScroll={handleScrollContainer}
        className="flex-1 overflow-y-auto ocean-scrollbar px-4 py-6"
      >
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 ocean-fade-in">
              {avatar ? (
                <img src={avatar} alt="AI" className="w-16 h-16 object-cover mb-6" />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-ocean-400 to-ocean-600 flex items-center justify-center shadow-lg mb-6">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 2L14.09 8.26L20 9.27L15.5 13.14L16.82 19.02L12 16.09L7.18 19.02L8.5 13.14L4 9.27L9.91 8.26L12 2Z"
                      fill="white"
                      stroke="white"
                      strokeWidth="1"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              )}
              <h2 className="text-xl font-semibold text-text-primary mb-2">
                {welcomeTitle}
              </h2>
              <p className="text-sm text-text-tertiary text-center max-w-sm">
                {welcomeDescription}
              </p>
              {/* Suggested messages */}
              <div className="flex flex-wrap gap-2 mt-8 justify-center max-w-lg">
                {(sdkConfig.suggestions && sdkConfig.suggestions.length > 0
                  ? sdkConfig.suggestions.map((item) => ({
                      label: item.label,
                      text: item.text ?? item.label,
                    }))
                  : [
                      t("chat.welcome.suggestion1"),
                      t("chat.welcome.suggestion2"),
                      t("chat.welcome.suggestion3"),
                    ].map((s) => ({ label: s, text: s }))
                ).map((suggestion) => (
                  <button
                    key={suggestion.label}
                    onClick={() => {
                      setInput("");
                      void sendUserText(suggestion.text);
                    }}
                    className="px-4 py-2 text-sm text-text-secondary border border-border rounded-xl hover:bg-surface hover:border-ocean-300 hover:text-ocean-600 transition-all cursor-pointer"
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <MessageRenderer
              key={message.id}
              message={message}
              onApprove={handleApprove}
              onDeny={handleDeny}
              onUserSelect={handleUserSelect}
              onDenySelect={handleDenySelect}
              showTrailingIndicator={
                isStreaming &&
                !stopRequested &&
                message.id === lastMessageId &&
                message.role === MESSAGE_ROLE.ASSISTANT
              }
              streamingActive={
                isResponseActive &&
                message.id === lastMessageId &&
                message.role === MESSAGE_ROLE.ASSISTANT
              }
            />
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="ocean-fade-in">
              <div className="flex gap-1.5 items-center py-2">
                <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
                <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
                <div className="w-2 h-2 rounded-full bg-ocean-400 ocean-typing-dot" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="px-4 py-2 mx-auto max-w-3xl mb-2 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 ocean-fade-in">
          <strong>{t("chat.error.label")}</strong> {typeof error.message === "string" ? error.message : JSON.stringify(error.message ?? error)}
        </div>
      )}

      {/* Input area */}
      <div className="px-4 pb-4 pt-2">
        <div className="max-w-3xl mx-auto">
          <form
            id="ocean-mcp-chat-form"
            onSubmit={handleSubmit}
            className="relative bg-surface border border-border rounded-2xl shadow-float transition-shadow focus-within:shadow-glow focus-within:border-ocean-300"
          >
            <CommandPalette
              open={showCommandPalette}
              commands={slashCommands}
              selectedIndex={commandSelectedIndex}
              onSelect={(command) => {
                void runSlashCommand(command);
              }}
            />
            {/* File preview area */}
            {pendingFiles.length > 0 && (
              <div className="px-4 pt-4 pb-2 border-b border-border/30">
                <div className="flex gap-2 overflow-x-auto overflow-y-visible">
                  {pendingFiles.map((pf) => (
                    <div
                      key={pf.id}
                      className="relative shrink-0 w-[45px] h-[45px] rounded-md border border-border bg-surface-secondary overflow-visible group"
                    >
                      {pf.status === "uploading" && (
                        <div className="w-full h-full flex items-center justify-center">
                          <div className="w-4 h-4 border-2 border-ocean-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                      {pf.status === "ready" && pf.attachment && (
                        <div className="w-full h-full overflow-hidden rounded-md">
                          {pf.attachment.mimeType.startsWith("image/") ? (
                            <img
                              src={pf.attachment.url}
                              alt={pf.attachment.name}
                              className="w-full h-full object-cover"
                              title={pf.attachment.name}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center" title={pf.attachment.name}>
                              <span className="text-xl">📄</span>
                            </div>
                          )}
                        </div>
                      )}
                      {pf.status === "error" && (
                        <div className="w-full h-full flex items-center justify-center bg-red-50" title={pf.error || "Error"}>
                          <span className="text-lg text-red-500">⚠</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeFile(pf.id)}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-black/80"
                        title={t("chat.upload.remove")}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={t("chat.input.placeholder")}
              rows={1}
              className="w-full resize-none bg-transparent px-4 pt-4 pb-12 text-sm text-text-primary placeholder-text-tertiary focus:outline-none rounded-2xl"
              style={{ minHeight: "56px", maxHeight: "200px" }}
              disabled={isStreaming || isLoading}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between px-2">
              <div className="flex items-center gap-2 text-text-tertiary">
                {showSessionBottomEntry && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowSessionList(true);
                      void refreshSessionMetas();
                    }}
                    disabled={isStreaming || isLoading}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer text-text-tertiary hover:text-text-secondary hover:bg-surface-tertiary"
                    title={t("chat.session.open")}
                  >
                    <SessionIcon />
                  </button>
                )}
                {uploadRegistry.isRegistered && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isStreaming || isLoading}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer text-text-tertiary hover:text-text-secondary hover:bg-surface-tertiary"
                    title={t("chat.upload.title")}
                  >
                    <AttachIcon />
                  </button>
                )}
              </div>
              {isStreaming || isLoading ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer bg-ocean-600 text-white hover:bg-ocean-700 shadow-sm"
                  title={t("chat.stop.title")}
                >
                  <StopIcon />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={
                    (!input.trim() && pendingFiles.filter(f => f.status === "ready").length === 0) ||
                    pendingFiles.some(f => f.status === "uploading")
                  }
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                    (input.trim() || pendingFiles.some(f => f.status === "ready")) &&
                    !pendingFiles.some(f => f.status === "uploading")
                      ? "bg-ocean-600 text-white hover:bg-ocean-700 shadow-sm"
                      : "bg-surface-tertiary text-text-tertiary"
                  }`}
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <SessionList
        open={sessionsEnabled && showSessionList}
        sessions={sessionMetas}
        currentSessionId={currentSessionId}
        onClose={() => setShowSessionList(false)}
        onSwitch={handleSwitchSession}
        onDelete={handleDeleteSession}
        onCreate={handleCreateSession}
      />

      {/* Drag and drop overlay */}
      {isDragging && uploadRegistry.isRegistered && (
        <div className="fixed inset-0 bg-white/90 flex items-center justify-center z-50 ocean-fade-in pointer-events-none">
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-ocean-500 flex items-center justify-center shadow-xl">
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-xl font-semibold text-text-primary mb-1">
                {t("chat.dragdrop.title")}
              </p>
              <p className="text-sm text-text-secondary">
                {t("chat.dragdrop.description")}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
