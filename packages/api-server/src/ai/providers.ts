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
    fast: privateLLM(
      process.env.LLM_FAST_MODEL || process.env.LLM_MODEL || "gpt-4o-mini",
    ),
  },
  fallbackProvider: privateLLM,
});

/**
 * Get a language model by ID.
 * Uses the unified provider which maps model IDs to concrete model instances.
 */
export function getLanguageModel(modelId?: string): LanguageModel {
  return provider.languageModel(modelId || "default") as LanguageModel;
}
