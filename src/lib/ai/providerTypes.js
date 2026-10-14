/**
 * Shim (plan 59): the canonical implementation moved to
 * src/core/providers/types.js.
 *
 * This path is kept stable on purpose — existing importers (options.js,
 * providerUpdate.js, tests) and vi.mock() module-path interception both depend
 * on it. Do not add logic here; edit the core module instead.
 */
export * from "../../core/providers/types.js";
