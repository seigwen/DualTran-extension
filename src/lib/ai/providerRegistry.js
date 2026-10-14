/**
 * Shim (plan 59): the canonical implementation moved to
 * src/core/providers/registry.js.
 *
 * This path is kept stable on purpose — existing importers (sw.js, options.js,
 * content scripts, tests) and vi.mock() module-path interception both depend on
 * it. Do not add logic here; edit the core module instead.
 */
export * from "../../core/providers/registry.js";
