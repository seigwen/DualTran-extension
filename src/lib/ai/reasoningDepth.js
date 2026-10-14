/**
 * Shim (plan 59): the canonical implementation moved to
 * src/core/providers/reasoningDepth.js.
 *
 * This path is kept stable on purpose — existing importers (aiProxy.js,
 * options.js, tests) depend on it. Do not add logic here; edit the core
 * module instead.
 */
export * from "../../core/providers/reasoningDepth.js";
