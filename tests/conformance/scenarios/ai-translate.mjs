import { aiConfig, hasCjk } from "./_shared.mjs";

export default {
  id: "ai-translate",
  // Firefox is excluded: seeding an AI provider into a temporary add-on is not possible
  // from the test process (storage is extension-private, and the options page is
  // privileged scope that Selenium refuses to script). Tracked as the P1 follow-up.
  engines: ["chromium"],
  needsMock: "sse-ok",
  config: (env) => aiConfig(env.mock.url),
  async run(ctx, env, assert) {
    await ctx.open(env.fixtureUrl);
    await ctx.waitForFloating();
    await ctx.clickFloating("Ai");

    // The AI pass runs block by block after the initial page translation, so wait for the
    // endpoint to be hit rather than for the first translated node (that one is Google).
    let texts = [];
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      texts = await ctx.translated();
      if (env.mock.requests.length > 0 && texts.some((t) => t.includes("MOCK-AI"))) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert("AI request reached the endpoint", env.mock.requests.length > 0, `${env.mock.requests.length} request(s)`);
    assert("AI translation rendered", texts.length > 0, `${texts.length} node(s)`);
    assert("AI translation is the mock sentinel", texts.some((t) => t.includes("MOCK-AI")), JSON.stringify(texts.slice(0, 1)));
  },
};
