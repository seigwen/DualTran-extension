"use strict";

/**
 * Create a dynamic provider card UI controller.
 * @param {Object} opts
 * @param {HTMLElement} opts.container - DOM element to render cards into
 * @param {Object[]} opts.providers - initial provider list
 * @param {Function} [opts.onActivate] - called when user activates a provider
 * @param {Function} [opts.onSaveCustom] - called when user saves a custom provider
 * @param {Function} [opts.onDeleteCustom] - called when user deletes a custom provider
 * @param {string} [opts.activeProviderId] - currently active provider id
 * @returns {Object} UI controller API
 */
export function createProviderUI(opts = {}) {
  const {
    container,
    providers = [],
    onActivate,
    onSaveCustom,
    onDeleteCustom,
    activeProviderId = "",
  } = opts;

  let _providers = [...providers];
  let _activeId = activeProviderId;

  function canEdit(provider) {
    return provider.source === "user";
  }

  function canDelete(provider) {
    return provider.source === "user";
  }

  function filterProviders(search = "", category = "") {
    let results = [..._providers];
    if (search) {
      const q = search.toLowerCase();
      results = results.filter((p) =>
        [p.name, p.shortDesc || "", p.id, ...(p.tags || [])].join(" ").toLowerCase().includes(q)
      );
    }
    if (category) {
      results = results.filter((p) => p.category === category);
    }
    return results;
  }

  function setProviders(newProviders) {
    _providers = [...newProviders];
  }

  function setActiveProvider(id) {
    _activeId = id;
  }

  function render(search = "", category = "") {
    if (!container) return;
    container.innerHTML = "";

    const filtered = filterProviders(search, category);

    for (const provider of filtered) {
      const card = _createProviderCard(provider);
      container.appendChild(card);
    }
  }

  function _createProviderCard(provider) {
    const card = document.createElement("div");
    card.className = "provider-card";
    card.dataset.providerId = provider.id;

    const isActive = provider.id === _activeId;

    card.innerHTML = `
      <div class="provider-card-header">
        <span class="provider-card-name">${_escapeHtml(provider.name)}</span>
        ${isActive ? '<span class="provider-active-badge">Active</span>' : ""}
        ${provider.source === "user" ? '<span class="provider-card-source">Custom</span>' : ""}
      </div>
      ${provider.shortDesc ? `<p class="provider-card-desc">${_escapeHtml(provider.shortDesc)}</p>` : ""}
      <div class="provider-card-meta">
        ${provider.apiBase ? `<span class="provider-card-endpoint">${_escapeHtml(provider.apiBase)}</span>` : ""}
        ${provider.website ? `<a href="${_escapeHtml(provider.website)}" target="_blank" class="provider-card-link">Website</a>` : ""}
        ${provider.apiKeyUrl ? `<a href="${_escapeHtml(provider.apiKeyUrl)}" target="_blank" class="provider-card-link">Get API Key</a>` : ""}
      </div>
      <div class="provider-card-actions">
        ${!isActive ? `<button class="provider-activate-btn" data-action="activate" data-id="${provider.id}">Activate</button>` : ""}
        ${canEdit(provider) ? `<button class="provider-edit-btn" data-action="edit" data-id="${provider.id}">Edit</button>` : ""}
        ${canDelete(provider) ? `<button class="provider-delete-btn" data-action="delete" data-id="${provider.id}">Delete</button>` : ""}
      </div>
    `;

    card.querySelector("[data-action='activate']")?.addEventListener("click", () => {
      onActivate?.(provider.id);
    });
    card.querySelector("[data-action='edit']")?.addEventListener("click", () => {
      _showEditForm(provider);
    });
    card.querySelector("[data-action='delete']")?.addEventListener("click", () => {
      if (confirm(`Delete provider "${provider.name}"?`)) {
        onDeleteCustom?.(provider.id);
      }
    });

    return card;
  }

  function _showEditForm(provider) {
    if (!container) return;
    container.innerHTML = `
      <div class="provider-edit-form">
        <h3>Edit ${_escapeHtml(provider.name)}</h3>
        <label>Name: <input id="editProviderName" value="${_escapeHtml(provider.name)}"></label>
        <label>API Base URL: <input id="editProviderApiBase" value="${_escapeHtml(provider.apiBase)}"></label>
        <label>API Key URL: <input id="editProviderApiKeyUrl" value="${_escapeHtml(provider.apiKeyUrl || '')}"></label>
        <button id="saveProviderEdit">Save</button>
        <button id="cancelProviderEdit">Cancel</button>
      </div>
    `;
    container.querySelector("#saveProviderEdit")?.addEventListener("click", () => {
      const updated = {
        ...provider,
        name: container.querySelector("#editProviderName")?.value || provider.name,
        apiBase: container.querySelector("#editProviderApiBase")?.value || provider.apiBase,
        apiKeyUrl: container.querySelector("#editProviderApiKeyUrl")?.value || provider.apiKeyUrl,
      };
      onSaveCustom?.(updated);
    });
    container.querySelector("#cancelProviderEdit")?.addEventListener("click", () => render());
  }

  function _escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return {
    render,
    setProviders,
    setActiveProvider,
    filterProviders,
    canEdit,
    canDelete,
  };
}
