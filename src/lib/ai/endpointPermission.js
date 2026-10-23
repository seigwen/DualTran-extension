/**
 * Host permission helpers for user-supplied AI endpoints.
 *
 * Firefox (and Chrome) apply CORS to extension requests unless the extension holds a
 * host permission for the target origin. Most AI providers do not send CORS headers —
 * ollama.com answers without `Access-Control-Allow-Origin` — so a custom endpoint only
 * works once the user grants access to that origin.
 */

/**
 * Convert an API base URL into a match pattern usable with permissions.request().
 * Returns "" for empty, relative or non-HTTP(S) input.
 * @param {string} apiBase
 * @returns {string} e.g. "https://ollama.com/*"
 */
export function endpointOriginPattern(apiBase) {
  try {
    const url = new URL(String(apiBase || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return `${url.origin}/*`;
  } catch {
    return "";
  }
}
