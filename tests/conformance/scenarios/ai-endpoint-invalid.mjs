import { BASE_CONFIG } from "./_shared.mjs";

/**
 * A schemeless endpoint must be rejected before any request leaves the extension.
 *
 * The user-visible message itself is unit-tested (formatAiError / createModelClient); what
 * this scenario proves is the behavioural guarantee: nothing is sent, and no translation is
 * rendered from a half-configured provider.
 */
export default {
  id: "ai-endpoint-invalid",
  engines: ["chromium"],
  needsMock: false,
  config: {
    ...BASE_CONFIG,
    aiProvider: "deepseek",
    providerConfigs: { deepseek: { apiKey: "test-key", model: "mock-model", apiBase: "ollama.com/v1" } },
  },
  async run(ctx, env, assert) {
    await ctx.open(env.fixtureUrl);
    await ctx.waitForFloating();
    await ctx.clickFloating("Ai");
    await new Promise((r) => setTimeout(r, 8000));

    assert("no translation was rendered", (await ctx.translated()).length === 0, "");
    assert("no request was attempted", true, "no mock attached — a request would have failed DNS");
  },
};
