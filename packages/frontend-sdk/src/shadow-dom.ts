/**
 * Shadow DOM utilities for the OceanMCP frontend SDK.
 *
 * All SDK UI is rendered inside a Shadow DOM to prevent style pollution
 * between the SDK and the host application. This module provides helpers
 * to create the shadow host, inject styles via `adoptedStyleSheets`, and
 * observe/clone dynamically-injected styles from third-party libraries
 * (e.g. Monaco Editor) into the shadow root.
 *
 * ## Tailwind CSS v4 `@property` workaround
 *
 * Tailwind v4 relies on CSS `@property` at-rules to define initial values
 * for internal custom properties (`--tw-shadow`, `--tw-gradient-stops`, etc.).
 * `@property` is a **document-level** construct — browsers silently ignore it
 * inside Shadow DOM `adoptedStyleSheets`.
 *
 * Tailwind ships a fallback that sets these variables on `*, ::before, ::after`
 * but wraps it in an `@supports` guard that only matches browsers **without**
 * `@property` support.  Modern browsers skip the fallback because they *do*
 * support `@property` — which then doesn't work inside the shadow root.
 *
 * `patchCssForShadowDom()` neutralises that guard so the fallback always
 * applies.  `hoistPropertyRulesToDocument()` additionally registers the
 * `@property` rules on the host document so typed initial values and
 * animation interpolation still work.
 *
 * See: https://github.com/tailwindlabs/tailwindcss/issues/15005
 *      https://github.com/tailwindlabs/tailwindcss/discussions/16772
 */

// ─── Active shadow root reference ──────────────────────────────────────────
let _activeShadowRoot: ShadowRoot | null = null;

/** Returns the active shadow root used by the SDK, or `null` if not mounted. */
export function getActiveShadowRoot(): ShadowRoot | null {
  return _activeShadowRoot;
}

// ─── Shadow host creation ──────────────────────────────────────────────────

export type ShadowHostResult = {
  shadowRoot: ShadowRoot;
  /** The inner `<div>` where React should be mounted. */
  mountPoint: HTMLDivElement;
};

/**
 * Attach a shadow root to the given container element and create an inner
 * mount point for React rendering.
 *
 * ```
 * <container>                 ← the host element (light DOM)
 *   #shadow-root (open)
 *     <div id="ocean-mcp-inner">  ← React mounts here
 *     </div>
 * </container>
 * ```
 */
export function createShadowHost(container: HTMLElement): ShadowHostResult {
  const shadowRoot = container.attachShadow({ mode: "open" });

  const mountPoint = document.createElement("div");
  mountPoint.id = "ocean-mcp-inner";
  mountPoint.style.height = "100%";
  shadowRoot.appendChild(mountPoint);

  _activeShadowRoot = shadowRoot;

  return { shadowRoot, mountPoint };
}

// ─── Style injection via adoptedStyleSheets ────────────────────────────────

/**
 * Inject a CSS string into the shadow root using the `adoptedStyleSheets` API.
 *
 * This is the preferred approach for style isolation — the stylesheet is only
 * visible within the shadow boundary and cannot leak into the host page.
 */
export function injectStyles(shadowRoot: ShadowRoot, cssText: string): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssText);
  shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
}

// ─── Tailwind CSS v4 @property workaround for Shadow DOM ───────────────────

/**
 * The `@supports` condition Tailwind v4 uses to gate the `--tw-*` variable
 * fallbacks.  It targets browsers that do **not** support `@property`.
 * Modern browsers pass this test (they *do* support `@property`), so the
 * fallback block is skipped — which breaks Shadow DOM where `@property`
 * declarations are ignored.
 *
 * We replace this condition with one that is universally true so the
 * fallback variables always apply inside the shadow root.
 */
const TW_SUPPORTS_GUARD =
  "(((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b))))";

/**
 * Patch a Tailwind v4 CSS string so its `--tw-*` variable fallbacks are
 * always applied, even inside a Shadow DOM.
 *
 * Under normal circumstances Tailwind relies on `@property` at-rules to
 * provide initial values for internal custom properties.  `@property` is
 * document-scoped and has no effect inside shadow roots.  Tailwind also
 * emits a fallback block that sets the same variables on
 * `*, ::before, ::after, ::backdrop`, but gates it behind an `@supports`
 * query that only matches browsers *without* `@property` support.
 *
 * This function replaces that `@supports` condition with `(display:block)`
 * (always true) so the fallback always fires inside the shadow root.
 */
export function patchCssForShadowDom(css: string): string {
  // The guard string is stable across Tailwind v4 releases (it's generated
  // by the compiler, not hand-written).  A plain string replace is both
  // faster and more predictable than a regex here.
  return css.replaceAll(TW_SUPPORTS_GUARD, "(display:block)");
}

/**
 * Extract `@property` rules from the CSS and register them on the host
 * document so that typed initial values and animation interpolation still
 * work (e.g. animating `box-shadow` via Tailwind utilities).
 *
 * This is safe to call multiple times — duplicate registrations are
 * silently ignored by the browser.
 */
export function hoistPropertyRulesToDocument(css: string): void {
  const propertyBlocks = css.match(/@property\s+--[\w-]+\s*\{[^}]*\}/g);
  if (!propertyBlocks || propertyBlocks.length === 0) return;

  const ID = "ocean-mcp-tw-properties";

  // Avoid duplicate injection
  if (document.getElementById(ID)) return;

  const style = document.createElement("style");
  style.id = ID;
  style.textContent = propertyBlocks.join("\n");
  document.head.appendChild(style);
}

// ─── Monaco Editor style observer ──────────────────────────────────────────
//
// Monaco Editor injects styles into `document.head` in two ways:
//
// 1. **`<link rel="stylesheet">`** — When loaded via CDN (the default for
//    `@monaco-editor/loader`), Monaco's AMD bundle appends a `<link>` pointing
//    to `editor.main.css`.  This contains all core structural CSS (layout,
//    scrollbar, gutter, diff overlays, etc.).
//
// 2. **`<style>` elements** — Monaco dynamically creates `<style>` tags for
//    theme colors, token colors, codicon fonts, and programmatic CSS rules
//    (via `createCSSRule` / `insertRule`).  Some carry `data-vscode-*`
//    attributes; others are plain `<style>` tags whose content references
//    `.monaco-editor` selectors.
//
// Both kinds are invisible inside a Shadow DOM.  We observe `document.head`
// and clone matching elements into the shadow root.
//
// See: https://github.com/microsoft/monaco-editor/pull/5159
//      https://github.com/microsoft/monaco-editor/issues/5145

/**
 * Attribute prefixes that identify Monaco Editor's injected `<style>` tags.
 * Monaco uses `data-vscode-*` attributes on its style elements.
 */
const MONACO_STYLE_MARKERS = [
  "data-vscode-theme-id",
  "data-vscode-theme-kind",
] as const;

/**
 * Check whether a DOM node is a Monaco-injected `<style>` or `<link>` element.
 *
 * Matches:
 * - `<link rel="stylesheet">` whose `href` references Monaco CSS files
 * - `<style>` tags with `data-vscode-*` attributes
 * - `<style>` tags whose `textContent` contains Monaco-specific selectors
 */
function isMonacoStyleNode(node: Node): node is HTMLElement {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as HTMLElement;

  // ── <link rel="stylesheet"> with Monaco CSS href ──────────────────────
  if (el.tagName === "LINK") {
    const link = el as HTMLLinkElement;
    if (link.rel !== "stylesheet") return false;
    const href = link.href || "";
    // The CDN-loaded Monaco appends a <link> whose href contains
    // "monaco-editor" or "vs/editor/editor.main.css".
    return (
      href.includes("monaco-editor") ||
      href.includes("vs/editor") ||
      href.includes("editor.main.css")
    );
  }

  // ── <style> elements ──────────────────────────────────────────────────
  if (el.tagName !== "STYLE") return false;

  // Monaco style tags carry `data-vscode-*` attributes
  for (const attr of MONACO_STYLE_MARKERS) {
    if (el.hasAttribute(attr)) return true;
  }

  // Also match style tags injected by `monaco-editor` loader (no special
  // attributes, but they are <style> children of <head> added dynamically).
  // We use a broader heuristic: any <style> tag whose textContent contains
  // Monaco-specific CSS selectors.
  const text = el.textContent || "";
  if (
    text.includes(".monaco-editor") ||
    text.includes(".monaco-diff-editor") ||
    text.includes(".vs-dark .monaco") ||
    text.includes(".monaco-scrollable-element")
  ) {
    return true;
  }

  return false;
}

/**
 * Track which source elements have already been cloned into the shadow root,
 * so we don't duplicate them on re-observation or mutation callbacks.
 */
const _clonedElements = new WeakSet<HTMLElement>();

/**
 * Observe `document.head` for dynamically-added `<style>` and `<link>`
 * elements from Monaco Editor and clone them into the shadow root so they
 * take effect inside the isolated widget.
 *
 * Handles two kinds of mutations:
 * - `childList`: new `<style>` / `<link>` nodes added to `<head>`
 * - `characterData` / `childList` on subtree: Monaco updates existing
 *   `<style>` elements' `textContent` when the theme changes
 *
 * Returns a cleanup function that disconnects the observer.
 */
export function observeMonacoStyles(shadowRoot: ShadowRoot): () => void {
  // Map from source <style> element → CSSStyleSheet clone in the shadow root,
  // so we can update it when Monaco changes the source element's content.
  const styleSheetMap = new Map<HTMLElement, CSSStyleSheet>();

  // First pass: clone any Monaco styles already present in <head>
  for (const node of Array.from(document.head.children)) {
    if (isMonacoStyleNode(node)) {
      cloneIntoShadow(node, shadowRoot, styleSheetMap);
    }
  }

  // Watch for future additions and content changes
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // New nodes added to <head>
      if (mutation.type === "childList") {
        for (const added of Array.from(mutation.addedNodes)) {
          if (isMonacoStyleNode(added)) {
            cloneIntoShadow(added, shadowRoot, styleSheetMap);
          }
        }
      }

      // Existing <style> element content changed (Monaco theme updates)
      if (
        mutation.type === "characterData" ||
        mutation.type === "childList"
      ) {
        const target = mutation.target;
        // The mutation target may be the text node inside a <style> element,
        // so walk up to the parent <style> element.
        const styleEl =
          target.nodeType === Node.TEXT_NODE
            ? target.parentElement
            : (target as HTMLElement);
        if (styleEl && styleSheetMap.has(styleEl)) {
          const sheet = styleSheetMap.get(styleEl)!;
          const newText = styleEl.textContent || "";
          try {
            sheet.replaceSync(newText);
          } catch {
            // If replaceSync fails, remove the old sheet and re-clone
            shadowRoot.adoptedStyleSheets =
              shadowRoot.adoptedStyleSheets.filter((s) => s !== sheet);
            styleSheetMap.delete(styleEl);
            _clonedElements.delete(styleEl);
            cloneIntoShadow(styleEl, shadowRoot, styleSheetMap);
          }
        }
      }
    }
  });

  observer.observe(document.head, {
    childList: true,
    // Observe text content changes inside <style> elements so we can
    // propagate Monaco theme updates into the shadow root.
    subtree: true,
    characterData: true,
  });

  return () => observer.disconnect();
}

/**
 * Clone a Monaco `<style>` or `<link>` element into the shadow root.
 *
 * - `<link>` elements are cloned as-is (the browser fetches the CSS via the
 *   same `href`, which is already cached).  This is the approach recommended
 *   by the official Monaco web-component sample.
 *
 * - `<style>` elements are cloned via `adoptedStyleSheets` for better
 *   performance.  A reference is stored in `styleSheetMap` so we can update
 *   the sheet in-place when Monaco changes the source element's content.
 *
 * See: https://github.com/microsoft/monaco-editor/pull/5159
 */
function cloneIntoShadow(
  el: HTMLElement,
  shadowRoot: ShadowRoot,
  styleSheetMap: Map<HTMLElement, CSSStyleSheet>,
): void {
  // Avoid duplicating the same element
  if (_clonedElements.has(el)) return;
  _clonedElements.add(el);

  // ── <link> elements: clone the node directly ──────────────────────────
  if (el.tagName === "LINK") {
    shadowRoot.appendChild(el.cloneNode(true));
    return;
  }

  // ── <style> elements: use adoptedStyleSheets for in-place updates ─────
  const cssText = el.textContent || "";
  if (!cssText) return;

  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
    styleSheetMap.set(el, sheet);
  } catch {
    // Fallback: insert a <style> element directly
    const clone = document.createElement("style");
    clone.textContent = cssText;
    shadowRoot.appendChild(clone);
  }
}
