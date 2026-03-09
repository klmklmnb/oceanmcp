import React, { useState, useEffect } from "react";
import { t } from "../locale";

interface MessageReasoningProps {
  reasoning: string;
  isLoading?: boolean;
}

export function MessageReasoning({
  reasoning,
  isLoading,
}: MessageReasoningProps) {
  // Don't render empty reasoning blocks
  if (!reasoning.trim() && !isLoading) {
    return null;
  }

  const [isOpen, setIsOpen] = useState(false);
  const [duration, setDuration] = useState(0);
  const [startTime] = useState<number>(Date.now());

  useEffect(() => {
    if (isLoading) {
      const interval = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isLoading, startTime]);

  // Auto-collapse when done loading, after a short delay
  useEffect(() => {
    if (!isLoading && isOpen) {
      // Optional: auto-collapse logic if desired
      // setIsOpen(false);
    }
  }, [isLoading]);

  return (
    <div className="my-2 border border-border/50 rounded-lg bg-surface-secondary/50 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex min-w-0 items-center gap-2 w-full px-3 py-2 text-left text-xs text-text-tertiary hover:bg-surface-tertiary/50 transition-colors"
      >
        <div
          className={`shrink-0 p-1 rounded-sm ${isLoading ? "animate-pulse text-ocean-500" : ""}`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5c0-5 5-5 5-5" />
          </svg>
        </div>
        <span className="min-w-0 flex-1 truncate font-medium">
          {isLoading ? t("reasoning.loading") : t("reasoning.title")}
        </span>
        {isLoading && (
          <span className="ml-auto shrink-0 whitespace-nowrap text-text-quaternary">{duration}s</span>
        )}
        {!isLoading && (
          <svg
            className={`ml-auto shrink-0 w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        )}
      </button>

      {isOpen && (
        <div className="px-3 pb-3 pt-0">
          <div className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap font-mono bg-surface-tertiary/30 p-2 rounded border border-border/30">
            {reasoning}
          </div>
        </div>
      )}
    </div>
  );
}
