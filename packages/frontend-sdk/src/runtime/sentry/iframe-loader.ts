import { sentryState } from "./state";
import type { OceanWindow, RuntimeConfig, SentryModule } from "./types";

const MAX_EXISTING_SCRIPT_WAIT_MS = 5_000;

async function getIframeContainer(): Promise<HTMLElement | null> {
  if (typeof document === "undefined") {
    return null;
  }

  if (document.body || document.documentElement) {
    return document.body ?? document.documentElement;
  }

  return new Promise((resolve) => {
    const onReady = () => {
      document.removeEventListener("DOMContentLoaded", onReady);
      resolve(document.body ?? document.documentElement);
    };

    document.addEventListener("DOMContentLoaded", onReady, { once: true });
  });
}

async function getSentryIframe(): Promise<HTMLIFrameElement> {
  if (sentryState.iframe?.isConnected) {
    return sentryState.iframe;
  }

  const container = await getIframeContainer();
  if (!container) {
    throw new Error("[OceanMCP] Failed to resolve a DOM container for the Sentry iframe.");
  }

  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.setAttribute("aria-hidden", "true");
  container.appendChild(iframe);
  sentryState.iframe = iframe;
  return iframe;
}

export async function loadIframeSentry(
  config: RuntimeConfig,
): Promise<SentryModule> {
  const iframe = await getSentryIframe();
  const iframeWindow = iframe.contentWindow as OceanWindow | null;
  const iframeDoc = iframe.contentDocument || iframeWindow?.document;
  const bundleUrl = config.bundleUrl;

  if (!iframeDoc || !iframeWindow) {
    throw new Error("[OceanMCP] Failed to access the Sentry iframe document.");
  }

  if (iframeWindow.Sentry) {
    return iframeWindow.Sentry;
  }

  return new Promise((resolve, reject) => {
    const existingScript = iframeDoc.querySelector<HTMLScriptElement>(
      `script[src="${bundleUrl}"]`,
    );

    if (existingScript) {
      const startedAt = Date.now();
      const checkLoaded = () => {
        if (iframeWindow.Sentry) {
          resolve(iframeWindow.Sentry);
          return;
        }

        if (Date.now() - startedAt > MAX_EXISTING_SCRIPT_WAIT_MS) {
          reject(
            new Error("[OceanMCP] Timed out waiting for the existing Sentry script."),
          );
          return;
        }

        requestAnimationFrame(checkLoaded);
      };

      checkLoaded();
      return;
    }

    const script = iframeDoc.createElement("script");
    script.src = bundleUrl;
    script.crossOrigin = "anonymous";
    if (config.bundleIntegrity) {
      script.integrity = config.bundleIntegrity;
    }

    script.onload = () => {
      if (!iframeWindow.Sentry) {
        reject(new Error("[OceanMCP] Sentry bundle loaded, but no global client was found."));
        return;
      }
      resolve(iframeWindow.Sentry);
    };

    script.onerror = () => {
      reject(new Error("[OceanMCP] Failed to load the Mihoyo Sentry bundle."));
    };

    (iframeDoc.head || iframeDoc.documentElement).appendChild(script);
  });
}
