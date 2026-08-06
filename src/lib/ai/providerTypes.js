"use strict";

/**
 * @typedef {Object} AuthConfig
 * @property {"bearer"|"api-key-header"|"query-param"} type
 * @property {string} header
 * @property {string} [prefix]
 * @property {string} [queryParam]
 */

/**
 * @typedef {Object} ModelListParser
 * @property {string} path
 * @property {string} valueKey
 * @property {string} labelKey
 * @property {string} [filter]
 */

/**
 * @typedef {Object} ProviderDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} website
 * @property {string} apiKeyUrl
 * @property {string} [shortDesc]
 * @property {string} apiBase
 * @property {string|null} modelListUrl
 * @property {AuthConfig} auth
 * @property {"openai-sse"|"openai-json"|"anthropic-sse"|"gemini-json"} responseFormat
 * @property {boolean} supportsStreaming
 * @property {ModelListParser} [modelListParser]
 * @property {Object<string,string>} [extraHeaders]
 * @property {"built-in"|"remote"|"user"} source
 * @property {"global"|"china"|"opensource"|"enterprise"} category
 * @property {string[]} [tags]
 */

const VALID_RESPONSE_FORMATS = ["openai-sse", "openai-json", "anthropic-sse", "gemini-json"];
const VALID_AUTH_TYPES = ["bearer", "api-key-header", "query-param"];
const VALID_SOURCES = ["built-in", "remote", "user"];
const VALID_CATEGORIES = ["global", "china", "opensource", "enterprise"];

const REQUIRED_FIELDS = [
  "id", "name", "website", "apiKeyUrl", "apiBase",
  "auth", "responseFormat", "supportsStreaming", "source", "category",
];

/**
 * @param {Object} def
 * @returns {string[]} error messages, empty if valid
 */
export function validateProviderDefinition(def) {
  const errors = [];

  if (!def || typeof def !== "object") {
    return ["Provider definition must be an object"];
  }

  for (const field of REQUIRED_FIELDS) {
    if (def[field] === undefined || def[field] === null) {
      // website/apiKeyUrl can be empty string for user providers
      if ((field === "website" || field === "apiKeyUrl") && def.source === "user" && def[field] === "") {
        continue;
      }
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (typeof def.id !== "string" || !def.id.trim()) {
    errors.push("id must be a non-empty string");
  }

  if (typeof def.name !== "string" || !def.name.trim()) {
    errors.push("name must be a non-empty string");
  }

  if (typeof def.apiBase !== "string" || !def.apiBase.trim()) {
    errors.push("apiBase must be a non-empty string");
  }

  if (def.auth && typeof def.auth === "object") {
    if (!VALID_AUTH_TYPES.includes(def.auth.type)) {
      errors.push(`auth.type must be one of: ${VALID_AUTH_TYPES.join(", ")}`);
    }
    if (!def.auth.header && def.auth.type !== "query-param") {
      errors.push("auth.header is required for bearer and api-key-header types");
    }
  } else {
    errors.push("auth must be an object with at least `type` and `header`");
  }

  if (!VALID_RESPONSE_FORMATS.includes(def.responseFormat)) {
    errors.push(`responseFormat must be one of: ${VALID_RESPONSE_FORMATS.join(", ")}`);
  }

  if (typeof def.supportsStreaming !== "boolean") {
    errors.push("supportsStreaming must be a boolean");
  }

  if (!VALID_SOURCES.includes(def.source)) {
    errors.push(`source must be one of: ${VALID_SOURCES.join(", ")}`);
  }

  if (!VALID_CATEGORIES.includes(def.category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }

  // modelListUrl can be null or a string URL
  if (def.modelListUrl !== null && def.modelListUrl !== undefined && typeof def.modelListUrl !== "string") {
    errors.push("modelListUrl must be a string or null");
  }

  // extraHeaders is optional but must be an object if present
  if (def.extraHeaders !== undefined && (typeof def.extraHeaders !== "object" || def.extraHeaders === null)) {
    errors.push("extraHeaders must be an object if provided");
  }

  // tags is optional but must be an array if present
  if (def.tags !== undefined && !Array.isArray(def.tags)) {
    errors.push("tags must be an array if provided");
  }

  return errors;
}
