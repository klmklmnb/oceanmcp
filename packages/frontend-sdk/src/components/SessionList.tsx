import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SessionMeta } from "../session/session-adapter";
import { t } from "../locale";

type SessionListProps = {
  open: boolean;
  sessions: SessionMeta[];
  currentSessionId: string | null;
  onClose: () => void;
  onSwitch: (sessionId: string) => Promise<void>;
  onDelete: (sessionId: string) => Promise<void>;
  onCreate: () => Promise<void>;
};

function PlusIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" />
      <path d="M19 6l-1 13a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function formatTimestamp(value: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

export function SessionList({
  open,
  sessions,
  currentSessionId,
  onClose,
  onSwitch,
  onDelete,
  onCreate,
}: SessionListProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const initialSelectedIndex = useMemo(() => {
    if (sessions.length === 0) return -1;
    const currentIndex = sessions.findIndex((session) => session.id === currentSessionId);
    return currentIndex >= 0 ? currentIndex : 0;
  }, [sessions, currentSessionId]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const timer = window.setTimeout(() => setVisible(true), 10);
      return () => window.clearTimeout(timer);
    }

    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), 190);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(initialSelectedIndex);
  }, [open, initialSelectedIndex]);

  useEffect(() => {
    if (selectedIndex < sessions.length) return;
    setSelectedIndex(sessions.length === 0 ? -1 : sessions.length - 1);
  }, [selectedIndex, sessions.length]);

  useEffect(() => {
    if (!open || !mounted) return;
    const timer = window.setTimeout(() => {
      panelRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !mounted) return;
    if (selectedIndex < 0 || selectedIndex >= sessions.length) return;
    const selectedItem = panelRef.current?.querySelector<HTMLElement>(
      `[data-session-item-index="${selectedIndex}"]`,
    );
    selectedItem?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [mounted, open, selectedIndex, sessions.length]);

  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (sessions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => {
        const current = prev < 0 ? initialSelectedIndex : prev;
        return current + 1 >= sessions.length ? 0 : current + 1;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => {
        const current = prev < 0 ? initialSelectedIndex : prev;
        return current - 1 < 0 ? sessions.length - 1 : current - 1;
      });
      return;
    }

    if (event.key === "Enter") {
      if (event.repeat) return;
      event.preventDefault();
      const target = sessions[selectedIndex] ?? sessions[0];
      if (target) {
        void onSwitch(target.id);
      }
    }
  };

  if (!mounted) return null;

  return (
    <div
      className={`absolute inset-0 z-30 flex items-center justify-center p-4 transition-colors duration-180 ${
        visible ? "bg-black/20 backdrop-blur-[1px]" : "bg-black/0"
      }`}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        className={`w-full max-w-[520px] max-h-[72vh] rounded-2xl border border-border bg-surface shadow-float flex flex-col transition-all duration-180 ease-out ${
          visible
            ? "opacity-100 translate-y-0 scale-100"
            : "opacity-0 translate-y-2 scale-[0.98]"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/40">
          <div>
            <div className="text-sm font-semibold text-text-primary">
              {t("chat.session.title")}
            </div>
            <div className="text-[11px] text-text-tertiary mt-0.5">
              {t("chat.session.description")}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void onCreate()}
              className="h-7 px-2.5 rounded-lg border border-ocean-200 bg-ocean-50 text-ocean-700 hover:bg-ocean-100 hover:border-ocean-300 transition-all cursor-pointer inline-flex items-center gap-1.5 text-[11px] font-medium"
            >
              <PlusIcon />
              {t("chat.session.new")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-surface-secondary transition-colors cursor-pointer"
              title={t("chat.session.close")}
            >
              ×
            </button>
          </div>
        </div>

        <div
          className="flex-1 overflow-y-auto ocean-scrollbar p-2.5 space-y-1.5"
          data-session-list-scroll="true"
        >
          {sessions.length === 0 && (
            <div className="text-xs text-text-tertiary px-1.5 py-3">
              {t("chat.session.empty")}
            </div>
          )}

          {sessions.map((session, index) => {
            const active = session.id === currentSessionId;
            const keyboardSelected = index === selectedIndex;
            return (
              <div
                key={session.id}
                data-session-item-index={index}
                className={`rounded-lg border px-2.5 py-2 transition-colors ${
                  active
                    ? "border-ocean-300 bg-ocean-50"
                    : "border-border bg-surface-secondary/60"
                } ${keyboardSelected ? "ring-2 ring-ocean-300/80" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 text-left cursor-pointer flex-1"
                    onClick={() => void onSwitch(session.id)}
                  >
                    <div className="truncate text-[13px] font-medium text-text-primary">
                      {session.title || t("chat.session.untitled")}
                    </div>
                    <div className="text-[11px] text-text-tertiary mt-0.5">
                      {t("chat.session.updatedAt", {
                        time: formatTimestamp(session.updatedAt),
                      })}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="shrink-0 h-7 px-2 rounded-md border border-transparent text-[11px] text-text-tertiary hover:text-red-600 hover:bg-red-50 hover:border-red-100 transition-colors cursor-pointer inline-flex items-center gap-1"
                    onClick={() => void onDelete(session.id)}
                    title={t("chat.session.delete")}
                  >
                    <TrashIcon />
                    {t("chat.session.delete")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
