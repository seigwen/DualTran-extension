import { aiConfig } from "./_shared.mjs";

/**
 * A 200 that carries an HTML page must fail loudly, not silently: the request goes out and
 * the page ends up without an AI translation.
 *
 * (The exact message text is covered by tests/core/formatAiError.test.js — the floating
 * panel keeps error text in extension state, not in a DOM node this runner can read.)
 */
export default {
  id: "ai-html-200",
  // Experimental: the AI pass does not always reach the model in this harness, so the
  // scenario is excluded from the default matrix (`--all` runs it). The message contract it
  // targets is covered by tests/core/formatAiError.test.js.
  experimental: true,
  engines: ["chromium", "firefox"],
  needsMock: "html-200",
  config: (env) => aiConfig(env.mock.url),
  async run(ctx, env, assert) {
    await ctx.open(env.fixtureUrl);
    await ctx.waitForFloating();
    await ctx.clickFloating("Ai");

    const deadline = Date.now() + 40000;
    while (Date.now() < deadline && env.mock.requests.length === 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 3000));

    const texts = await ctx.translated();
    assert("the request reached the endpoint", env.mock.requests.length > 0, `${env.mock.requests.length} request(s)`);
    assert("no AI translation was rendered", !texts.some((t) => t.includes("MOCK-AI")), texts.slice(0, 1).join(""));
  },
};
