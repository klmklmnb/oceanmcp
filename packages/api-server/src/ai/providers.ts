import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { customProvider, type LanguageModel } from "ai";

// ── Private / Self-Hosted LLM Adapter ────────────────────────────────────────

const privateLLM = createOpenAICompatible({
  name: "private-llm",
  baseURL: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
  apiKey: process.env.LLM_API_KEY,
  headers: {
    ...(process.env.LLM_TOKEN
      ? { "X-Custom-Auth": process.env.LLM_TOKEN }
      : {}),
  },
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
