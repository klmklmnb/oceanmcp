import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { customProvider, type LanguageModel } from "ai";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelConfig } from "@ocean-mcp/shared";

// ── Model-family detection & thinking/reasoning injection ────────────────────

type ModelFamily = "claude" | "openai" | "glm" | "unknown";

/**
 * Detect the model family from the model name string.
 * Runs on every request so it works when the frontend switches models dynamically.
 */
function detectModelFamily(modelName: string): ModelFamily {
  const lower = modelName.toLowerCase();
  if (lower.includes("claude")) return "claude";
  if (lower.includes("glm")) return "glm";
  if (/\b(gpt|o[1-4])-/.test(lower)) return "openai";
  return "unknown";
}

// ── Environment-level defaults (read once at startup) ────────────────────────

// Claude
const ENV_THINKING_BUDGET = (() => {
  const raw = process.env.LLM_THINKING_BUDGET ?? "10240";
  if (raw === "0" || raw.toLowerCase() === "disabled") return 0;
  return Math.max(1024, Number(raw) || 10240);
})();

// OpenAI
const ENV_REASONING_EFFORT = (() => {
  const raw = process.env.LLM_REASONING_EFFORT ?? "medium";
  if (raw.toLowerCase() === "disabled") return undefined;
  return raw as "low" | "medium" | "high" | "none";
})();

// GLM
const ENV_GLM_THINKING = (process.env.LLM_GLM_THINKING ?? "true").toLowerCase() === "true";

// ── Per-request config via AsyncLocalStorage ─────────────────────────────────

/**
 * Resolved thinking/reasoning configuration for the current request.
 * Values are resolved by merging SDK mount params → env vars → defaults.
 */
export interface ThinkingConfig {
  /** Claude thinking.budget_tokens. 0 = disabled. */
  claudeBudget: number;
  /** OpenAI reasoning_effort. undefined = disabled. */
  openaiEffort: "low" | "medium" | "high" | "none" | undefined;
  /** GLM enable_thinking flag. */
  glmThinking: boolean;
}

const thinkingConfigStore = new AsyncLocalStorage<ThinkingConfig>();

/**
 * Resolve the effective ThinkingConfig by merging:
 *   1. SDK `modelConfig` values (per-request, from the frontend)
 *   2. `LLM_*` environment variables (per-deployment)
 *   3. Built-in defaults
 */
export function resolveThinkingConfig(modelConfig?: ModelConfig): ThinkingConfig {
  // Claude budget
  let claudeBudget = ENV_THINKING_BUDGET;
  if (modelConfig?.thinkingBudget != null) {
    claudeBudget = modelConfig.thinkingBudget <= 0
      ? 0
      : Math.max(1024, modelConfig.thinkingBudget);
  }

  // OpenAI reasoning effort
  let openaiEffort = ENV_REASONING_EFFORT;
  if (modelConfig?.reasoningEffort != null) {
    openaiEffort = modelConfig.reasoningEffort === "disabled"
      ? undefined
      : modelConfig.reasoningEffort;
  }

  // GLM thinking
  let glmThinking = ENV_GLM_THINKING;
  if (modelConfig?.glmThinking != null) {
    glmThinking = modelConfig.glmThinking;
  }

  return { claudeBudget, openaiEffort, glmThinking };
}

/**
 * Run an async function with the given ThinkingConfig available to the
 * `customFetch` interceptor via AsyncLocalStorage.
 */
export function withThinkingConfig<T>(config: ThinkingConfig, fn: () => T): T {
  return thinkingConfigStore.run(config, fn);
}

/**
 * Inject model-family-specific thinking/reasoning parameters into the
 * request body. Mutates `bodyObj` in place and returns `true` if any
 * field was added.
 */
function injectThinkingParams(bodyObj: Record<string, any>): boolean {
  const modelName: string = bodyObj.model ?? "";
  const family = detectModelFamily(modelName);
  const config = thinkingConfigStore.getStore() ?? {
    claudeBudget: ENV_THINKING_BUDGET,
    openaiEffort: ENV_REASONING_EFFORT,
    glmThinking: ENV_GLM_THINKING,
  };

  switch (family) {
    // ── Claude: { thinking: { type: "enabled", budget_tokens: N } } ────
    case "claude": {
      if (config.claudeBudget <= 0) break;
      if (bodyObj.thinking) break;
      bodyObj.thinking = {
        type: "enabled",
        budget_tokens: config.claudeBudget,
      };
      return true;
    }

    // ── OpenAI: { reasoning_effort: "low"|"medium"|"high"|"none" } ─────
    case "openai": {
      if (!config.openaiEffort) break;
      if (bodyObj.reasoning_effort) break;
      bodyObj.reasoning_effort = config.openaiEffort;
      return true;
    }

    // ── GLM: { extra_body: { chat_template_kwargs: { enable_thinking } } }
    case "glm": {
      if (!config.glmThinking) break;
      if (bodyObj.extra_body?.chat_template_kwargs?.enable_thinking != null) break;
      bodyObj.extra_body = {
        ...bodyObj.extra_body,
        chat_template_kwargs: {
          ...(bodyObj.extra_body?.chat_template_kwargs ?? {}),
          enable_thinking: true,
        },
      };
      return true;
    }

    default:
      break;
  }

  return false;
}

// ── Custom fetch: thinking/reasoning parameter injection ─────────────────────

/**
 * Custom fetch wrapper that injects thinking/reasoning parameters into the
 * request body based on the detected model family.
 */
const customFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  let actualInit = init;

  if (init?.body) {
    try {
      const bodyStr =
        typeof init.body === "string"
          ? init.body
          : new TextDecoder().decode(init.body as ArrayBuffer);
      const bodyObj = JSON.parse(bodyStr);

      if (bodyObj.model && injectThinkingParams(bodyObj)) {
        actualInit = {
          ...init,
          body: JSON.stringify(bodyObj),
        };
      }
    } catch {
      /* body not JSON — pass through unchanged */
    }
  }

  return globalThis.fetch(input, actualInit);
};

// ── Private / Self-Hosted LLM Adapter ────────────────────────────────────────

const privateLLM = createOpenAICompatible({
  // IMPORTANT: The name MUST be "google" — not a cosmetic choice.
  // @ai-sdk/openai-compatible uses this name as a key for providerMetadata.
  // When reconstructing outbound messages, the SDK hardcodes a lookup on
  // `providerOptions.google.thoughtSignature` to round-trip Gemini's
  // thought_signature on tool calls (see convert-to-openai-compatible-chat-messages.ts).
  // Any other name causes the signature to be silently dropped, making
  // Gemini reject multi-step tool-use requests.
  name: "google",
  baseURL: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
  apiKey: process.env.LLM_API_KEY,
  headers: {
    ...(process.env.LLM_TOKEN
      ? { "X-Custom-Auth": process.env.LLM_TOKEN }
      : {}),
  },
  fetch: customFetch as any,
});

// ── Unified Provider ─────────────────────────────────────────────────────────

const provider = customProvider({
  languageModels: {
    default: privateLLM(process.env.LLM_MODEL || "gpt-4o"),
    /**
     * Fast / lightweight model alias.
     *
     * **Not yet used** — currently registered for future use. The plan is to
     * route simple, low-latency tasks (e.g. intent classification, short
     * summaries, tool-selection steps) to this cheaper model while keeping
     * the "default" alias for complex reasoning tasks.
     *
     * To activate it, call `getLanguageModel("fast")` or
     * `getLanguageModel(modelConfig.fast)` in the relevant code path.
     */
    fast: privateLLM(
      process.env.LLM_FAST_MODEL || process.env.LLM_MODEL || "gpt-4o-mini",
    ),
  },
  fallbackProvider: privateLLM,
});

/**
 * Get a language model by ID.
 *
 * Resolution order:
 * 1. Explicit `modelId` parameter (from frontend `ModelConfig.default`)
 * 2. `LLM_MODEL` environment variable (from .env)
 * 3. `"default"` alias (maps to gpt-4o)
 *
 * When `modelId` matches a registered alias ("default", "fast") the mapped
 * model is returned. Otherwise it falls through to the `fallbackProvider`
 * (privateLLM) which creates a model instance for the raw model name.
 */
export function getLanguageModel(modelId?: string): LanguageModel {
  const resolved = modelId || process.env.LLM_MODEL || "default";
  return provider.languageModel(resolved) as LanguageModel;
}

/**
 * Resolve maxOutputTokens for a streamText call.
 *
 * Resolution order:
 * 1. Explicit value from frontend `ModelConfig.maxTokens`
 * 2. `LLM_MAX_TOKENS` environment variable
 * 3. `undefined` (let the provider use its own default)
 */
export function resolveMaxTokens(maxTokens?: number): number | undefined {
  if (maxTokens != null && maxTokens > 0) return maxTokens;
  const envVal = Number(process.env.LLM_MAX_TOKENS);
  if (envVal > 0) return envVal;
  return undefined;
}
