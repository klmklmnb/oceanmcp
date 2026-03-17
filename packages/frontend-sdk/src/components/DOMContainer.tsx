import React, { useRef, useEffect } from "react";
import type { DOMRenderDescriptor } from "oceanmcp-shared";

/**
 * Type guard: checks whether a `showRender` return value is a
 * {@link DOMRenderDescriptor} (framework-agnostic container callback)
 * rather than a React node.
 */
export function isDOMRenderDescriptor(val: unknown): val is DOMRenderDescriptor {
  return (
    val != null &&
    typeof val === "object" &&
    (val as any).type === "dom" &&
    typeof (val as any).render === "function"
  );
}

/**
 * Bridge component that renders a {@link DOMRenderDescriptor} inside the
 * SDK's React tree.
 *
 * Lifecycle:
 *  1. Mount  — creates an empty `<div>`, calls `descriptor.render(container)`
 *              once so the host can imperatively populate it.
 *  2. Update — parent re-renders are intentionally **ignored**. The host owns
 *              the container's content and manages its own updates.
 *  3. Unmount — calls `descriptor.cleanup()` to release host-side resources
 *              (chart instances, framework app instances, event listeners, …).
 *
 * The effect uses an empty dependency array (`[]`) on purpose.
 * `showRender` is called during the parent's render phase and always returns
 * a new object reference, so depending on `descriptor` directly would cause
 * the host's DOM to be destroyed and rebuilt on every parent re-render.
 * A ref (`descriptorRef`) keeps access to the latest descriptor without
 * triggering the effect.
 */
export function DOMContainer({ descriptor }: { descriptor: DOMRenderDescriptor }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | undefined>(undefined);

  // Always keep the latest descriptor accessible without re-triggering the effect.
  const descriptorRef = useRef(descriptor);
  descriptorRef.current = descriptor;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    descriptorRef.current.render(node);
    cleanupRef.current = descriptorRef.current.cleanup;

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = undefined;
    };
    // Empty deps: render once on mount, cleanup once on unmount.
    // See JSDoc above for rationale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} />;
}
