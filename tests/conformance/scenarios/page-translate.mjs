import { BASE_CONFIG, hasCjk } from "./_shared.mjs";

export default {
  id: "page-translate",
  engines: ["chromium", "firefox"],
  needsMock: false,
  config: BASE_CONFIG,
  async run(ctx, env, assert) {
    await ctx.open(env.fixtureUrl);
    await ctx.waitForFloating();
    await ctx.clickFloating("Google");

    let texts = [];
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      texts = await ctx.translated();
      if (texts.length > 0) break;
      await ctx.driver?.sleep?.(500) ?? new Promise((r) => setTimeout(r, 500));
    }
    assert("translated nodes appear", texts.length > 0, `${texts.length} node(s)`);
    assert("translation is Chinese", texts.some(hasCjk), JSON.stringify(texts.slice(0, 2)));
  },
};
