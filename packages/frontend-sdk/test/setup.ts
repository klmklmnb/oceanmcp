import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  window.history.replaceState({}, "", "/chat?room=alpha");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
