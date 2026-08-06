"use strict";

import { createProviderRegistry, BUILT_IN_PROVIDERS } from "../lib/ai/providerRegistry.js";

const _defaultRegistry = createProviderRegistry(BUILT_IN_PROVIDERS);

/**
 * 将兼容 OpenAI 的聊天端点规范化为模型列表端点。
 * @param {string} endpoint
 * @returns {string}
 */
export function normalizeOpenAiCompatibleModelsEndpoint(endpoint) {
  /** @type {string} */
  const sanitizedEndpoint = String(endpoint || "").trim();
  if (!sanitizedEndpoint) return "";

  try {
    /** @type {URL} */
    const parsed = new URL(sanitizedEndpoint);
    /** @type {string} */
    const basePath = parsed.pathname
      .replace(/\/chat\/completions\/?$/, "")
      .replace(/\/models\/?$/, "")
      .replace(/\/+$/, "");
    parsed.pathname = `${basePath}/models`;
    return parsed.href;
  } catch (_) {
    return sanitizedEndpoint;
  }
}

function normalizeOptions(records, getValue, getLabel) {
  const normalized = Array.isArray(records)
    ? records
        .map((record) => {
          const value = getValue(record);
          if (!value) return null;
          return {
            value,
            text: getLabel(record) || value,
          };
        })
        .filter(Boolean)
    : [];

  normalized.sort((left, right) => String(left.text || left.value).localeCompare(String(right.text || right.value)));
  return normalized;
}

async function tryReadErrorMessage(response) {
  try {
    const payload = await response.json();
    return payload?.error?.message || "";
  } catch (_) {
    return "";
  }
}

/**
 * Build request URL and options from provider definition.
 */
function _buildModelListRequest(providerDef, apiKey, endpoint) {
  const key = (apiKey || "").trim();
  const normalizedEndpoint = normalizeOpenAiCompatibleModelsEndpoint(endpoint);
  let url = normalizedEndpoint || providerDef.modelListUrl;

  // For OpenRouter-style endpoints: derive model list URL from chat endpoint
  if (providerDef.id === "openrouter" && endpoint) {
    url = normalizedEndpoint || url;
  }

  // For Azure OpenAI: build model list URL from user's endpoint
  if (providerDef.id === "azure-openai" && endpoint) {
    const sanitizedEndpoint = String(endpoint).trim().replace(/\/+$/, "");
    url = `${sanitizedEndpoint}/openai/models?api-version=2023-12-01-preview`;
  }

  // For Google Gemini: build model list URL with API key in query string
  if (providerDef.id === "google-gemini") {
    url = `${providerDef.apiBase}/models?key=${encodeURIComponent(key)}`;
  }

  const options = { headers: {} };

  // Only add auth headers if we have a key
  if (key) {
    switch (providerDef.auth.type) {
      case "bearer":
        options.headers.Authorization = `${providerDef.auth.prefix || "Bearer "}${key}`;
        break;
      case "api-key-header":
        options.headers[providerDef.auth.header] = key;
        break;
      case "query-param":
        // URL already contains the key for Gemini-style providers
        break;
    }
  }

  // Extra headers from definition
  if (providerDef.extraHeaders) {
    Object.assign(options.headers, providerDef.extraHeaders);
  }

  // Omit headers object if empty (backward compat with old tests)
  if (Object.keys(options.headers).length === 0) {
    delete options.headers;
  }

  return { url, options };
}

function _getNested(obj, path) {
  if (!path || obj == null) return "";
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null) return "";
    current = current[part];
  }
  return current ?? "";
}

/**
 * Extract model options from API payload using the provider's parser definition.
 */
function _extractModelOptions(payload, parser) {
  if (!parser) return [];

  const pathParts = parser.path.split(".");
  let records = payload;
  for (const part of pathParts) {
    if (records == null) return [];
    records = records[part];
  }

  if (!Array.isArray(records)) return [];

  const seenIds = new Set();
  const filtered = records.filter((record) => {
    const value = _getNested(record, parser.valueKey);
    if (!value) return false;
    if (seenIds.has(value)) return false;

    if (parser.filter) {
      try {
        const filterStr = parser.filter;
        let pattern, flags;
        if (filterStr.startsWith("/")) {
          const lastSlash = filterStr.lastIndexOf("/");
          pattern = filterStr.slice(1, lastSlash);
          flags = filterStr.slice(lastSlash + 1);
        } else {
          pattern = filterStr;
          flags = undefined;
        }
        const regex = new RegExp(pattern, flags);
        if (!regex.test(value)) return false;
      } catch (_) {
        // Invalid regex — include all
      }
    }

    seenIds.add(value);
    return true;
  });

  const models = filtered.map((record) => ({
    value: _getNested(record, parser.valueKey),
    text: _getNested(record, parser.labelKey) || _getNested(record, parser.valueKey),
  }));

  models.sort((a, b) => String(a.text).localeCompare(String(b.text)));
  return models;
}

/**
 * Fetch a model list from a provider's API based on its registry definition.
 * @param {Object} params
 * @param {string} params.provider - provider id
 * @param {string} [params.apiKey]
 * @param {string} [params.endpoint] - unused (kept for backward compat)
 * @param {Function} [params.fetcher=fetch]
 * @param {Function} [params.translate] - i18n function
 * @param {Object} [params.registry] - registry override
 * @returns {Promise<Array<{value: string, text: string}>>}
 */
export async function loadAiProviderModelOptions({
  provider,
  apiKey = "",
  endpoint: _endpoint,
  fetcher = fetch,
  translate = (_key, fallback) => fallback,
  registry = _defaultRegistry,
}) {
  const providerDef = registry.getProvider(provider);

  if (!providerDef) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }

  if (!providerDef.modelListUrl
      && !(providerDef.id === "azure-openai" && _endpoint)
      && providerDef.id !== "google-gemini") {
    throw new Error(`Provider "${providerDef.name}" does not expose a model list API.`);
  }

  const { url, options } = _buildModelListRequest(providerDef, apiKey, _endpoint);
  const response = await fetcher(url, options);

  if (!response.ok) {
    const apiMessage = await tryReadErrorMessage(response);
    const fallback = translate(
      `msgCannotLoadModelsHttp`,
      `Unable to load ${providerDef.name} models (HTTP ${response.status})`
    );
    throw new Error(apiMessage || fallback);
  }

  const payload = await response.json();
  const models = _extractModelOptions(payload, providerDef.modelListParser);
  if (!models.length) {
    const fallback = translate(
      `msgCannotLoadModelsEmpty`,
      `${providerDef.name} models list is empty`
    );
    throw new Error(fallback);
  }

  return models;
}
