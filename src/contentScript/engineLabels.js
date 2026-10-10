/**
 * Engine display tokens (spec 47 P2 batch ③, issue #157).
 *
 * The engine row is `Original | Google | AI` in both button groups:
 * - "Google" is a trademark and "AI" an initialism — both render identically
 *   in every locale (the same call as the provider brand names), so they are
 *   declared TOKENS here rather than pushed through i18n.
 * - "Original" IS translated (key `btnOriginal`).
 *
 * Single source: the floating group (BUTTON_STYLES), the hover button group
 * (singleton template), and the block-state renderers all read these — the
 * floating label can never drift from the hover label again. The write sites
 * assign identifiers (not literals), which is also what the i18n write-site
 * guard (L1) checks: literals at *writes*, not declarations.
 */
import { getMessageWithFallback } from "./i18n.js";

export const GOOGLE_ENGINE_LABEL = "Google";
export const AI_ENGINE_LABEL = "AI";

/** Localized "Original" label; English kept only as a missing-runtime fallback. */
export function getOriginalButtonLabel() {
  return getMessageWithFallback("btnOriginal", "Original");
}
