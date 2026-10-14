/**
 * SDK mapping table: npm package name → createXxx function (plan 59 M2 —
 * moved here from src/background/aiProxy.js; the drift guard in
 * tests/ai/reasoningDepth.test.js reads THIS module's `const SDK_MAP =
 * Object.freeze({...})` block).
 *
 * Only includes SDK packages usable in browser/Service Worker environments.
 * Node.js-only packages (e.g. google-vertex, amazon-bedrock) use the
 * openai-compatible fallback through @ai-sdk/openai-compatible.
 *
 * ═══════════════════════════════════════════════════════════
 * Why do some providers use the openai-compatible fallback?
 * ═══════════════════════════════════════════════════════════
 *
 * OpenRouter is the canonical example: its API is fully OpenAI-compatible
 * (/v1/chat/completions), but has no @ai-sdk/openrouter entry in SDK_MAP.
 * This is intentional, not an oversight:
 *
 * 1. Vercel AI SDK does not ship an @ai-sdk/openrouter package.
 * 2. Mapping to @ai-sdk/openai would pull in OpenAI-specific features
 *    (Responses API, Realtime API, Files API) that OpenRouter doesn't support,
 *    and whose error-handling semantics may differ.
 * 3. @ai-sdk/openai-compatible is a cleaner abstraction — it depends only on
 *    the standard /v1/chat/completions contract, without binding to any
 *    provider's proprietary extensions.
 * 4. createOpenAICompatible({ baseURL: "https://openrouter.ai/api/v1" })
 *    produces HTTP requests functionally identical to createOpenAI — OpenRouter
 *    acts as a transparent proxy for the OpenAI format.
 *
 * The same applies to any other provider whose API is OpenAI-compatible but
 * lacks a dedicated SDK (100+ smaller providers in models.dev). As long as
 * their chat endpoint accepts standard OpenAI JSON, the openai-compatible
 * fallback works correctly.
 *
 * Only providers with non-standard APIs or important proprietary features
 * warrant a dedicated SDK_MAP entry (e.g. Anthropic Messages API,
 * Google Gemini generateContent API).
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createXai } from "@ai-sdk/xai";
import { createAzure } from "@ai-sdk/azure";
import { createMistral } from "@ai-sdk/mistral";
import { createCohere } from "@ai-sdk/cohere";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createGroq } from "@ai-sdk/groq";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createDeepInfra } from "@ai-sdk/deepinfra";

/** npm package name → createXxx function */
// NOTE: the set of packages listed here and the dialect table in
// src/core/providers/reasoningDepth.js must stay aligned — that module maps
// each of these npm packages to its providerOptions dialect, and a unit test
// asserts the two lists are equal. Adding an SDK here without adding the
// dialect (or vice versa) reintroduces the #88 class of silent drift.
const SDK_MAP = Object.freeze({
  "@ai-sdk/openai": createOpenAI,
  "@ai-sdk/anthropic": createAnthropic,
  "@ai-sdk/google": createGoogleGenerativeAI,
  "@ai-sdk/deepseek": createDeepSeek,
  "@ai-sdk/xai": createXai,
  "@ai-sdk/azure": createAzure,
  "@ai-sdk/mistral": createMistral,
  "@ai-sdk/cohere": createCohere,
  "@ai-sdk/togetherai": createTogetherAI,
  "@ai-sdk/groq": createGroq,
  "@ai-sdk/perplexity": createPerplexity,
  "@ai-sdk/deepinfra": createDeepInfra,
});

export { SDK_MAP };
