"use strict";

import { getSmartDefaultModel } from "../lib/ai/providerModelPreview.js";
import { renderFallbackState, renderLoadingState, renderModelOptions } from "./aiModelSelect.js";

export async function refreshAiModelSelect({
  select,
  storedValue = "",
  fallbackOptions = [],
  missingConfigNotice = "",
  loadOptions,
  getValue = (model) => model?.value,
  getLabel = (model) => model?.text,
  errorToNotice,
  onLoadedOptions,
  smartDefaultProvider, // Smart default: provider name, used by getSmartDefaultModel
}) {
  if (!select || select._isMissingElement) return [];

  renderLoadingState(select);

  if (missingConfigNotice) {
    renderFallbackState(select, {
      notice: missingConfigNotice,
      fallbackOptions,
      storedValue,
    });
    return [];
  }

  try {
    const models = await loadOptions();
    // Smart-compute default model for the selected provider
    let smartDefault;
    if (!storedValue && smartDefaultProvider) {
      smartDefault = getSmartDefaultModel({ provider: smartDefaultProvider, models });
    }
    const normalizedOptions = renderModelOptions(select, {
      models,
      storedValue,
      smartDefault,
      getValue,
      getLabel,
    });
    onLoadedOptions?.(normalizedOptions);
    return normalizedOptions;
  } catch (error) {
    renderFallbackState(select, {
      notice: typeof errorToNotice === "function" ? errorToNotice(error) : "",
      fallbackOptions,
      storedValue,
    });
    return [];
  } finally {
    select.disabled = false;
  }
}
