/**
 * Endpoint capability layer (plan 86, P3).
 *
 * An endpoint is not a free-form string: it has to be an absolute http(s) URL, it has to be
 * one the extension may talk to (host permission), and it has to answer. Validating here —
 * instead of inside the request path — is what turns "HTTP 200: Failed to process successful
 * response" into a sentence the user can act on.
 */

/** @typedef {{ok: boolean, url: string, origin: string, problem?: string, suggestion?: string}} NormalizedEndpoint */

/**
 * @param {string} raw
 * @returns {NormalizedEndpoint}
 */
export function normalizeEndpoint(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, url: "", origin: "", problem: "empty" };

  if (/\$\{[^}]+\}/.test(value)) {
    return { ok: false, url: "", origin: "", problem: "template-var" };
  }

  // A bare host is the common mistake ("ollama.com/v1"): do not guess the scheme, offer it.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return {
      ok: false,
      url: "",
      origin: "",
      problem: "missing-scheme",
      suggestion: `https://${value.replace(/^\/+/, "")}`,
    };
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, url: "", origin: "", problem: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, url: "", origin: "", problem: "not-http" };
  }
  if (url.search || url.hash) {
    return { ok: false, url: "", origin: "", problem: "has-query" };
  }

  // Users often paste the full request URL; the client appends the path itself.
  let pathname = url.pathname.replace(/\/+$/, "");
  pathname = pathname.replace(/\/(chat\/completions|completions)$/i, "");
  const normalized = `${url.origin}${pathname}`;
  return { ok: true, url: normalized, origin: url.origin };
}

/**
 * Human-readable, i18n-free description of the problem (the UI maps these keys to strings;
 * tests assert on keys so the wording can change without breaking them).
 * @param {string} problem
 * @returns {string}
 */
export function endpointProblemKey(problem) {
  switch (problem) {
    case "empty":
      return "endpointEmpty";
    case "missing-scheme":
      return "endpointMissingScheme";
    case "not-http":
      return "endpointNotHttp";
    case "template-var":
      return "endpointTemplateVar";
    case "has-query":
      return "endpointHasQuery";
    default:
      return "endpointInvalid";
  }
}

/**
 * Probe `{base}/models` to learn whether the endpoint exists and accepts the key.
 *
 * @param {string} baseUrl
 * @param {{apiKey?: string, timeoutMs?: number, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<{state: "ok"|"unauthorized"|"http-error"|"blocked"|"timeout", detail: string, ms: number}>}
 */
export async function probeEndpoint(baseUrl, { apiKey = "", timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/models`, {
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    });
    const ms = Date.now() - started;
    if (response.ok) return { state: "ok", detail: `HTTP ${response.status}`, ms };
    if (response.status === 401 || response.status === 403) {
      return { state: "unauthorized", detail: `HTTP ${response.status}`, ms };
    }
    return { state: "http-error", detail: `HTTP ${response.status}`, ms };
  } catch (error) {
    const ms = Date.now() - started;
    if (error?.name === "AbortError") return { state: "timeout", detail: `>${timeoutMs}ms`, ms };
    // A TypeError here is the browser's CORS/permission block: no status, no body.
    return { state: "blocked", detail: String(error?.message || error), ms };
  } finally {
    clearTimeout(timer);
  }
}
