import React, { useEffect, useState } from "react";
import type { SlashCommand } from "../command/command-registry";
import { t } from "../locale";

type CommandPaletteProps = {
  open: boolean;
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (command: SlashCommand) => void;
};

export function CommandPalette({
  open,
  commands,
  selectedIndex,
  onSelect,
}: CommandPaletteProps) {
  const shouldOpen = open && commands.length > 0;
  const [mounted, setMounted] = useState(shouldOpen);
  const [visible, setVisible] = useState(shouldOpen);

  useEffect(() => {
    if (shouldOpen) {
      setMounted(true);
      const timer = window.setTimeout(() => setVisible(true), 10);
      return () => window.clearTimeout(timer);
    }

    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), 170);
    return () => window.clearTimeout(timer);
  }, [shouldOpen]);

  if (!mounted) return null;

  return (
    <div
      className={`absolute left-0 right-0 bottom-full mb-2 z-20 transition-all duration-150 ease-out ${
        visible
          ? "opacity-100 translate-y-0 scale-100"
          : "opacity-0 translate-y-1 scale-[0.98] pointer-events-none"
      }`}
    >
      <div className="rounded-xl border border-border bg-surface shadow-float overflow-hidden">
        <ul className="max-h-56 overflow-y-auto ocean-scrollbar">
          {commands.map((command, index) => {
            const selected = index === selectedIndex;
            return (
              <li key={command.name}>
                <button
                  type="button"
                  className={`w-full px-3 py-2 text-left flex items-center gap-3 transition-colors cursor-pointer ${
                    selected
                      ? "bg-ocean-50 text-ocean-700"
                      : "text-text-primary hover:bg-surface-secondary"
                  }`}
                  onMouseDown={(event) => {
                    // Prevent textarea blur before command execution.
                    event.preventDefault();
                    onSelect(command);
                  }}
                >
                  <span className="text-xs font-medium shrink-0">/{command.name}</span>
                  <span className="text-xs text-text-secondary leading-5">
                    {command.descriptionKey ? t(command.descriptionKey) : command.description}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
