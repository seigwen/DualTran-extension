import { BASE_CONFIG } from "./_shared.mjs";

/**
 * A schemeless endpoint must be rejected before any request leaves the extension.
 *
 * A mock is attached so "no request" is observable. If the guard regresses, the request
 * either reaches the mock or dies on TLS; a silent success is caught by the AI-text check.
 * Page translation may still fall back to Google — that is allowed; claiming AI worked is not.
 */
export default {
  id: "ai-endpoint-invalid",
  engines: ["chromium", "firefox"],
  needsMock: "sse-ok",
  config: (env) => ({
    ...BASE_CONFIG,
    aiProvider: "deepseek",
    // No scheme: exactly what a user types after reading "ollama.com/v1" somewhere.
    providerConfigs: {
      deepseek: {
        apiKey: "test-key",
        model: "mock-model",
        apiBase: env.mock.origin.replace(/^https?:\/\//, "") + "/v1",
      },
    },
  }),
  async run(ctx, env, assert) {
    await ctx.open(env.fixtureUrl);
    await ctx.waitForFloating();
    await ctx.clickFloating("Ai");
    await new Promise((r) => setTimeout(r, 8000));

    const texts = await ctx.translated();
    assert("the invalid endpoint is never called", env.mock.requests.length === 0, `${env.mock.requests.length} request(s)`);
    assert("no AI translation is presented as success", !texts.some((t) => t.includes("MOCK-AI")), texts.slice(0, 1).join(""));
  },
};
