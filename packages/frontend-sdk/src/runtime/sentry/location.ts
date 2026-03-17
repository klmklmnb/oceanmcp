function tryGetLocation(getter: () => Location | undefined): Location | undefined {
  try {
    return getter();
  } catch {
    return undefined;
  }
}

export function getHostLocation(): Location | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (
    tryGetLocation(() =>
      window.top?.location?.href ? window.top.location : undefined,
    ) ??
    tryGetLocation(() =>
      window.parent?.location?.href ? window.parent.location : undefined,
    ) ??
    window.location
  );
}

export function isIframePlaceholderUrl(url: string | undefined): boolean {
  return url === undefined || url === "about:blank" || url === "about:srcdoc";
}
