  // Helper: 简写工具，用 $ 代替 document.querySelector（需要在文件中早期使用 $ 之前定义）
  // 返回匹配的 DOM 元素；若未找到则返回 null-safe 代理，避免后续属性访问（如 .onchange = ...）抛出 TypeError。
  var _rawQS = document.querySelector.bind(document);
  // 缓存的 null-safe 代理对象：吸收所有属性读写、方法调用和 addEventListener 等操作而不抛出异常。
  // 使用 Proxy 而非哑 DOM 元素，因为引用的 ID 涉及 <select>、<input> 等不同元素类型，
  // 需要兼容 .options、.selectedIndex、.checked、.value、.style 等各种属性。
  var _nullProxy = new Proxy(function () {}, {
    get: function (_target, prop) {
      // 标记属性：允许外部检查 if (el._isMissingElement) 来判断是否为哑代理
      if (prop === "_isMissingElement") return true;
      // 特殊属性：让 truthiness 检查和类型判断正常工作
      if (prop === Symbol.toPrimitive || prop === "valueOf") return function () { return 0; };
      if (prop === "toString") return function () { return ""; };
      // .options 应返回空的类数组以兼容 Array.from(select.options || [])
      if (prop === "options") return [];
      // .classList 返回一个空的 DOMTokenList 代理
      if (prop === "classList") return _nullProxy;
      // .style 返回自身代理（可连续赋值 .style.display = "none"）
      if (prop === "style") return _nullProxy;
      // .length 用于 options.length 等
      if (prop === "length") return 0;
      // 数值属性
      if (prop === "selectedIndex") return -1;
      // 布尔属性
      if (prop === "checked" || prop === "disabled") return false;
      // 字符串属性
      if (prop === "value" || prop === "innerHTML" || prop === "textContent" || prop === "color") return "";
      // 方法类属性返回空函数（addEventListener, appendChild, querySelector 等）
      if (prop === "addEventListener" || prop === "removeEventListener" ||
          prop === "appendChild" || prop === "removeChild" ||
          prop === "querySelector" || prop === "querySelectorAll" ||
          prop === "setAttribute" || prop === "removeAttribute" ||
          prop === "getAttribute" || prop === "contains" ||
          prop === "add" || prop === "remove" || prop === "toggle" ||
          prop === "splice" || prop === "forEach" || prop === "map" ||
          prop === "find" || prop === "some" || prop === "filter") {
        return function () { return _nullProxy; };
      }
      // ownerDocument — 部分代码如 renderModelOptions 会通过 select.ownerDocument.createElement 创建元素
      if (prop === "ownerDocument") return document;
      // dataset
      if (prop === "dataset") return {};
      // 其它属性返回 undefined（不再递归代理，避免无限深度）
      return undefined;
    },
    // 拦截属性赋值（如 .onchange = fn, .value = "xxx"）—
    // 在 null proxy 上这意味着目标 DOM 元素不存在，必须发出可见警告。
    set: function (_target, prop, _value) {
      // 事件处理器属性赋值是最危险的静默失败：handler 注册了但永不触发
      if (typeof prop === "string" && /^on(change|input|click|keyup|keydown|blur|focus)$/.test(prop)) {
        console.warn("[options.js] Cannot assign " + prop + " handler: target element not found in DOM. The handler will never fire.");
      }
      return true;
    },
    apply: function () { return _nullProxy; },  // 当作函数调用时返回代理自身
  });
  /** @type {typeof document.querySelector} */
  var $ = function $(selector) {
    var el = _rawQS(selector);
    if (el) return el;
    // 若元素未找到，打印一次警告便于调试，然后返回 null-safe 代理
    if (typeof console !== "undefined" && console.debug) {
      console.debug("[options.js] Element not found for selector:", selector);
    }
    return _nullProxy;
  };
  // Helper: 获取 i18n 文本并提供默认回退（避免某些 locale 缺少 key 导致空字符串）
  // 如果传入的 fallback 包含中文字符，则使用一组安全的替换规则将其转换为英文。
  // 该转换为本地化友好型的简单映射/规则，覆盖常见的错误提示与模型列表为空等句式。
  function i18nOrDefault(key, fallback) {
    try {
      const msg = chrome.i18n.getMessage(key);
      if (msg && msg.length) return msg;
    } catch (e) {
      // ignore
    }

    const fb = fallback || "";

    // 如果 fallback 包含中文汉字，则尝试转换为英文（基于安全的规则，避免调用外部翻译服务）
    if (/[\u4E00-\u9FFF]/.test(fb)) {
      let english = String(fb);

      // 先尝试捕获类似："无法加载<Provider>模型 (HTTP 123)" 这种形式
      english = english.replace(/无法加载\s*(.+?)\s*模型/g, 'Unable to load $1 models');
      // 常见句式替换
      english = english.replace(/无法从API加载/g, 'Unable to load from API');
      english = english.replace(/模型列表为空/g, 'models list is empty');
      // 一般 "模型" -> "models"，放在后面以避免覆盖上面的捕获规则
      english = english.replace(/模型/g, 'models');
      english = english.replace(/无法加载/g, 'Unable to load');

      // 如果替换后仍包含汉字（未命中规则），则退回到一个通用英文提示以保证可读性
      if (/[\u4E00-\u9FFF]/.test(english)) {
        // 保持括号内的 HTTP 状态码或其它括号内容
        const httpMatch = fb.match(/\(HTTP[^)]+\)/i);
        const httpPart = httpMatch ? ` ${httpMatch[0]}` : '';
        return `Unable to load models${httpPart}`;
      }

      return english;
    }

    return fb;
  }

  // Azure OpenAI模型下拉框自动填充
  async function populateAzureOpenAIModels(select, apiKey, endpoint, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) return;
    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    const sanitizedKey = (apiKey || "").trim();
    const sanitizedEndpoint = (endpoint || "").trim().replace(/\/$/, "");
    const hasConfig = sanitizedKey && sanitizedEndpoint;
    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        smartDefaultProvider: "azure-openai",
        missingConfigNotice: "",
        loadOptions: hasConfig
          ? () => loadAiProviderModelOptions({
              provider: "azure-openai",
              apiKey: sanitizedKey,
              endpoint: sanitizedEndpoint,
              translate: i18nOrDefault,
            })
          : () => loadPreviewModels({ provider: "azure-openai" }),
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
      });
    } catch (error) {
      console.warn("无法从API加载Azure OpenAI模型:", error);
    }
  }
  // Azure OpenAI模型下拉框自动填充逻辑
  const azureOpenAIModelSelect = $("#azureOpenAIModel");
  const fallbackAzureOpenAIOptions = azureOpenAIModelSelect
    ? Array.from(azureOpenAIModelSelect.options || []).map((option) => ({
        value: option.value,
        text: option.textContent,
      }))
    : [];
  const storedAzureOpenAIModel = twpConfig.get("azureOpenAIModel") || "";
  const apiKeyAzureOpenAIInput = $("#apiKeyAzureOpenAI");
  const storedApiKeyAzureOpenAI = (twpConfig.get("apiKeyAzureOpenAI") || "").trim();
  const azureOpenAIEndpointInput = $("#azureOpenAIEndpoint");
  const storedAzureOpenAIEndpoint = (twpConfig.get("azureOpenAIEndpoint") || "").trim();
  if (apiKeyAzureOpenAIInput) {
    apiKeyAzureOpenAIInput.value = storedApiKeyAzureOpenAI;
    apiKeyAzureOpenAIInput.onchange = (e) => {
      const newKey = (e.target.value || "").trim();
      apiKeyAzureOpenAIInput.value = newKey;
      twpConfig.set("apiKeyAzureOpenAI", newKey);
      if (azureOpenAIModelSelect) {
        const selectedModel =
          azureOpenAIModelSelect.value || twpConfig.get("azureOpenAIModel") || "";
        populateAzureOpenAIModels(
          azureOpenAIModelSelect,
          newKey,
          azureOpenAIEndpointInput ? azureOpenAIEndpointInput.value : "",
          selectedModel,
          fallbackAzureOpenAIOptions
        );
      }
    };
  }
  if (azureOpenAIEndpointInput) {
    azureOpenAIEndpointInput.value = storedAzureOpenAIEndpoint;
    azureOpenAIEndpointInput.onchange = (e) => {
      const newEndpoint = (e.target.value || "").trim();
      azureOpenAIEndpointInput.value = newEndpoint;
      twpConfig.set("azureOpenAIEndpoint", newEndpoint);
      if (azureOpenAIModelSelect) {
        const selectedModel =
          azureOpenAIModelSelect.value || twpConfig.get("azureOpenAIModel") || "";
        populateAzureOpenAIModels(
          azureOpenAIModelSelect,
          apiKeyAzureOpenAIInput ? apiKeyAzureOpenAIInput.value : "",
          newEndpoint,
          selectedModel,
          fallbackAzureOpenAIOptions
        );
      }
    };
  }
  if (azureOpenAIModelSelect) {
    populateAzureOpenAIModels(
      azureOpenAIModelSelect,
      storedApiKeyAzureOpenAI,
      storedAzureOpenAIEndpoint,
      storedAzureOpenAIModel,
      fallbackAzureOpenAIOptions
    );
    azureOpenAIModelSelect.onchange = (e) => {
      twpConfig.set("azureOpenAIModel", e.target.value);
    };
  }
  // DeepSeek模型下拉框自动填充
  async function populateDeepSeekModels(select, apiKey, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) return;
    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    const sanitizedKey = (apiKey || "").trim();
    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        smartDefaultProvider: "deepseek",
        missingConfigNotice: "",
        loadOptions: sanitizedKey
          ? () => loadAiProviderModelOptions({
              provider: "deepseek",
              apiKey: sanitizedKey,
              translate: i18nOrDefault,
            })
          : () => loadPreviewModels({ provider: "deepseek" }),
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
      });
    } catch (error) {
      console.warn("无法从API加载DeepSeek模型:", error);
    }
  }
  // DeepSeek模型下拉框自动填充逻辑
  const deepSeekModelSelect = $("#deepSeekModel");
  const fallbackDeepSeekOptions = deepSeekModelSelect
    ? Array.from(deepSeekModelSelect.options || []).map((option) => ({
        value: option.value,
        text: option.textContent,
      }))
    : [];
  const storedDeepSeekModel = twpConfig.get("deepSeekModel") || "";
  const apiKeyDeepSeekInput = $("#apiKeyDeepSeek");
  const storedApiKeyDeepSeek = (twpConfig.get("apiKeyDeepSeek") || "").trim();
  if (apiKeyDeepSeekInput) {
    apiKeyDeepSeekInput.value = storedApiKeyDeepSeek;
    apiKeyDeepSeekInput.onchange = (e) => {
      const newKey = (e.target.value || "").trim();
      apiKeyDeepSeekInput.value = newKey;
      twpConfig.set("apiKeyDeepSeek", newKey);
      if (deepSeekModelSelect) {
        const selectedModel =
          deepSeekModelSelect.value || twpConfig.get("deepSeekModel") || "";
        populateDeepSeekModels(
          deepSeekModelSelect,
          newKey,
          selectedModel,
          fallbackDeepSeekOptions
        );
      }
    };
  }
  if (deepSeekModelSelect) {
    populateDeepSeekModels(
      deepSeekModelSelect,
      storedApiKeyDeepSeek,
      storedDeepSeekModel,
      fallbackDeepSeekOptions
    );
    deepSeekModelSelect.onchange = (e) => {
      twpConfig.set("deepSeekModel", e.target.value);
    };
  }
  // Grok模型下拉框自动填充
  async function populateGrokModels(select, apiKey, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) return;
    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    const sanitizedKey = (apiKey || "").trim();
    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        smartDefaultProvider: "grok",
        missingConfigNotice: "",
        loadOptions: sanitizedKey
          ? () => loadAiProviderModelOptions({
              provider: "grok",
              apiKey: sanitizedKey,
              translate: i18nOrDefault,
            })
          : () => loadPreviewModels({ provider: "grok" }),
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
      });
    } catch (error) {
      console.warn("无法从API加载Grok模型:", error);
    }
  }
  // Grok模型下拉框自动填充逻辑
  const grokModelSelect = $("#grokModel");
  const fallbackGrokOptions = grokModelSelect
    ? Array.from(grokModelSelect.options || []).map((option) => ({
        value: option.value,
        text: option.textContent,
      }))
    : [];
  const storedGrokModel = twpConfig.get("grokModel") || "";
  const apiKeyGrokInput = $("#apiKeyGrok");
  const storedApiKeyGrok = (twpConfig.get("apiKeyGrok") || "").trim();
  if (apiKeyGrokInput) {
    apiKeyGrokInput.value = storedApiKeyGrok;
    apiKeyGrokInput.onchange = (e) => {
      const newKey = (e.target.value || "").trim();
      apiKeyGrokInput.value = newKey;
      twpConfig.set("apiKeyGrok", newKey);
      if (grokModelSelect) {
        const selectedModel =
          grokModelSelect.value || twpConfig.get("grokModel") || "";
        populateGrokModels(
          grokModelSelect,
          newKey,
          selectedModel,
          fallbackGrokOptions
        );
      }
    };
  }
  if (grokModelSelect) {
    populateGrokModels(
      grokModelSelect,
      storedApiKeyGrok,
      storedGrokModel,
      fallbackGrokOptions
    );
    grokModelSelect.onchange = (e) => {
      twpConfig.set("grokModel", e.target.value);
    };
  }
  // Anthropic模型下拉框自动填充
  async function populateAnthropicModels(select, apiKey, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) return;
    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    const sanitizedKey = (apiKey || "").trim();
    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        smartDefaultProvider: "anthropic",
        missingConfigNotice: "",
        loadOptions: sanitizedKey
          ? () => loadAiProviderModelOptions({
              provider: "anthropic",
              apiKey: sanitizedKey,
              translate: i18nOrDefault,
            })
          : () => loadPreviewModels({ provider: "anthropic" }),
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
      });
    } catch (error) {
      console.warn("无法从API加载Anthropic模型:", error);
    }
  }

  // Anthropic模型下拉框自动填充逻辑
  const anthropicModelSelect = $("#anthropicModel");
  const fallbackAnthropicOptions = anthropicModelSelect
    ? Array.from(anthropicModelSelect.options || []).map((option) => ({
        value: option.value,
        text: option.textContent,
      }))
    : [];
  const storedAnthropicModel = twpConfig.get("anthropicModel") || "";
  const apiKeyAnthropicInput = $("#apiKeyAnthropic");
  const storedApiKeyAnthropic = (twpConfig.get("apiKeyAnthropic") || "").trim();
  if (apiKeyAnthropicInput) {
    apiKeyAnthropicInput.value = storedApiKeyAnthropic;
    apiKeyAnthropicInput.onchange = (e) => {
      const newKey = (e.target.value || "").trim();
      apiKeyAnthropicInput.value = newKey;
      twpConfig.set("apiKeyAnthropic", newKey);
      if (anthropicModelSelect) {
        const selectedModel =
          anthropicModelSelect.value || twpConfig.get("anthropicModel") || "";
        populateAnthropicModels(
          anthropicModelSelect,
          newKey,
          selectedModel,
          fallbackAnthropicOptions
        );
      }
    };
  }
  if (anthropicModelSelect) {
    populateAnthropicModels(
      anthropicModelSelect,
      storedApiKeyAnthropic,
      storedAnthropicModel,
      fallbackAnthropicOptions
    );
    anthropicModelSelect.onchange = (e) => {
      twpConfig.set("anthropicModel", e.target.value);
    };
  }
"use strict"; // 启用严格模式，避免潜在的隐式错误

import twpLang from "../lib/languages.js" // 导入语言相关工具
import twpConfig from "../lib/config.js" // 导入配置存取模块
import platformInfo from "../lib/platformInfo.js" // 导入平台信息（判断移动端等）
import "../lib/i18n.js" // 导入国际化初始化脚本（副作用导入）
import { createAiOptionsController } from "./aiOptionsController.js";
import { enableDarkMode, disableDarkMode } from "./darkmode.js"; // 导入深色模式开关函数
import { loadAiProviderModelOptions, normalizeOpenAiCompatibleModelsEndpoint } from "./aiModelApi.js";
import { refreshAiModelSelect } from "./aiModelRefresh.js";
import { loadPreviewModels } from "../lib/ai/providerModelPreview.js";
import { createProviderRegistry, BUILT_IN_PROVIDERS, mergeRegistries, lookupKnownApiBase } from "../lib/ai/providerRegistry.js";
import { migrateProviderConfig } from "../lib/ai/providerMigration.js";
import 'toolcool-color-picker'; // 引入第三方取色器组件（自定义元素）

// 配置加载完成后执行主初始化逻辑
twpConfig.onReady(function () {
  if (platformInfo.isMobile.any) { // 如果是任意移动端
    let style = document.createElement("style"); // 动态创建 style 元素
    style.textContent = ".desktopOnly {display: none !important}"; // 隐藏仅桌面可见元素
    document.head.appendChild(style); // 注入到页面
  }

  let sideBarIsVisible = false; // 记录侧边栏当前是否展开，当页面宽度较小时（一般为移动端）为false，展开时为true

  $("#btnOpenMenu").onclick = (e) => { // 绑定菜单按钮点击事件，该按钮位于右上角，移动端可见。
    $("#menuContainer").classList.toggle("change"); // 切换动画/样式类

    if (sideBarIsVisible) { // 如果当前显示，则隐藏
      $("#sideBar").style.display = "none";
      sideBarIsVisible = false; // 更新状态
    } else { // 如果当前隐藏，则显示
      $("#sideBar").style.display = "block";
      sideBarIsVisible = true; // 更新状态
    }
  };

  /**
   * url hash变更事件的回调函数
   * 当url hash变更时, 显示hash代表的元素(选项卡内容), 隐藏其他元素
   */
  function hashchange() { // 处理地址栏 #hash 切换
    const hash = location.hash || "#languages"; // 当前 hash，默认语言选项卡
    const divs = [ // 所有选项卡内容块集合
      $("#languages"),
      $("#sites"),
      $("#translations"),
      $("#ai"),
      $("#style"),
      $("#hotkeys"),
      $("#storage"),
      $("#others"),
    ];
    divs.forEach((element) => { // 统一隐藏
      element.style.display = "none";
    });

    document.querySelectorAll("nav a").forEach((a) => { // 移除所有导航高亮
      a.classList.remove("w3-light-grey");
    });

    if($(hash).style.display){ // 如果当前 hash 对应元素有 display 属性（此判断似乎冗余）
      $(hash).style.display = "block"; // 显示对应 tab
    }
    $('a[href="' + hash + '"]').classList.add("w3-light-grey"); // 高亮对应导航链接

    let text; // 标题文本
    text = chrome.i18n.getMessage("lblSettings"); // 获取多语言标题

    $("#itemSelectedName").textContent = text; // 更新头部显示的选中项名称

    if (sideBarIsVisible) { // 如果侧边栏当前显示，切换为隐藏（移动端点击后关闭）
      $("#menuContainer").classList.toggle("change"); // 同步按钮视觉状态
      $("#sideBar").style.display = "none"; // 隐藏侧栏
      sideBarIsVisible = false; // 更新状态
    }

  }
  hashchange(); // 初始化时根据当前 hash 显示对应 tab
  window.addEventListener("hashchange", hashchange); // 监听 hash 变化

  /**
   * 为下拉列表填充语言列表
   * @param { Element } select 目标 select 元素(下拉列表)
   */
  function fillLanguageList(select) { // 动态填充语言下拉列表
    let langs = twpLang.getLanguageList(); // 获取语言映射（code->名称）

    const langsSorted = []; // 排序后的数组

    for (const i in langs) { // 遍历对象属性
      langsSorted.push([i, langs[i]]); // 推入数组供排序
    }

    langsSorted.sort(function (a, b) { // 按语言名称排序
      return a[1]?.localeCompare?.(b[1]);
    });

    langsSorted.forEach((value) => { // 生成并插入 option
      const option = document.createElement("option");
      option.value = value[0]; // 语言代码
      option.textContent = value[1]; // 显示名
      select.appendChild(option);
    });
  }

  fillLanguageList($("#selectTargetLanguage")); // 为网页翻译目标下拉列表填充语言列表
  fillLanguageList($("#selectTargetLanguageForText")); // 为文本翻译目标下拉列表填充语言列表

  fillLanguageList($("#favoriteLanguage1")); // 为收藏语言 1 下拉列表填充语言列表
  fillLanguageList($("#favoriteLanguage2")); // 为收藏语言 2 下拉列表填充语言列表
  fillLanguageList($("#favoriteLanguage3")); // 为收藏语言 3 下拉列表填充语言列表

  fillLanguageList($("#addToNeverTranslateLangs")); // 为永不翻译语言下拉列表填充语言列表
  fillLanguageList($("#addToAlwaysTranslateLangs")); // 为总是翻译语言下拉列表填充语言列表
  fillLanguageList($("#addLangToTranslateWhenHovering")); // 为悬停翻译语言下拉列表填充语言列表

  function updateDarkMode() { // 根据配置应用深色模式策略
    switch (twpConfig.get("darkMode")) { // 获取 darkMode 配置项
      case "auto": // 自动模式：根据系统偏好
        if (matchMedia("(prefers-color-scheme: dark)").matches) { // 若系统为暗色
          enableDarkMode(); // 启用
        } else {
          disableDarkMode(); // 否则禁用
        }
        break;
      case "yes": // 强制启用
        enableDarkMode();
        break;
      case "no": // 强制关闭
        disableDarkMode();
        break;
      default: // 其他情况不处理
        break;
    }
  }
  updateDarkMode(); // 初始化执行一次

  // 网页翻译目标语言配置
  const targetLanguage = twpConfig.get("targetLanguage"); // 当前网页翻译目标语言
  $("#selectTargetLanguage").value = targetLanguage; // 设置 select 初始值
  $("#selectTargetLanguage").onchange = (e) => { // 变更时事件
    console.log("target language is changed to: ", e.target.value) // 控制台记录
    twpConfig.setTargetLanguage(e.target.value); // 更新配置
    // reload options page 重新加载页面以刷新依赖语言的部分 UI
    location.reload();
  };

  // 文本翻译目标语言配置
  const targetLanguageTextTranslation = twpConfig.get(
    "targetLanguageTextTranslation"
  ); // 获取"文本翻译"目标语言
  $("#selectTargetLanguageForText").value = targetLanguageTextTranslation; // 设置初始值
  $("#selectTargetLanguageForText").onchange = (e) => { // 选择改变事件
    twpConfig.setTargetLanguage(e.target.value, true); // 设置文本翻译目标语言
    twpConfig.setTargetLanguage(targetLanguage, false); // 同步主语言（保持之前的主语言）
    location.reload(); // 重新加载刷新
  };

  // 优先目标语言配置
  const targetLanguages = twpConfig.get("targetLanguages"); // 收藏语言数组 [l1,l2,l3]
  $("#favoriteLanguage1").value = targetLanguages[0]; // 初始化收藏语言1
  $("#favoriteLanguage2").value = targetLanguages[1]; // 初始化收藏语言2
  $("#favoriteLanguage3").value = targetLanguages[2]; // 初始化收藏语言3

  $("#favoriteLanguage1").onchange = (e) => { // 收藏语言1变更
    targetLanguages[0] = e.target.value; // 更新内存中的数组
    twpConfig.set("targetLanguages", targetLanguages); // 保存
    if (targetLanguages.indexOf(twpConfig.get("targetLanguage")) == -1) { // 如果当前主语言不再收藏列表
      twpConfig.set("targetLanguage", targetLanguages[0]); // 重置为第一个收藏
    }
    if (
      targetLanguages.indexOf(twpConfig.get("targetLanguageTextTranslation")) ==
      -1
    ) { // 如果文本翻译目标语言不在收藏列表
      twpConfig.set("targetLanguageTextTranslation", targetLanguages[0]); // 重置
    }
    location.reload(); // 刷新界面
  };

  $("#favoriteLanguage2").onchange = (e) => { // 收藏语言2变更逻辑同上
    targetLanguages[1] = e.target.value;
    twpConfig.set("targetLanguages", targetLanguages);
    if (targetLanguages.indexOf(twpConfig.get("targetLanguage")) == -1) {
      twpConfig.set("targetLanguage", targetLanguages[0]);
    }
    if (
      targetLanguages.indexOf(twpConfig.get("targetLanguageTextTranslation")) ==
      -1
    ) {
      twpConfig.set("targetLanguageTextTranslation", targetLanguages[0]);
    }
    location.reload();
  };

  $("#favoriteLanguage3").onchange = (e) => { // 收藏语言3变更
    targetLanguages[2] = e.target.value;
    twpConfig.set("targetLanguages", targetLanguages);
    if (targetLanguages.indexOf(twpConfig.get("targetLanguage")) == -1) {
      twpConfig.set("targetLanguage", targetLanguages[0]);
    }
    if (
      targetLanguages.indexOf(twpConfig.get("targetLanguageTextTranslation")) ==
      -1
    ) {
      twpConfig.set("targetLanguageTextTranslation", targetLanguages[0]);
    }
    location.reload();
  };

  // 永不翻译语言列表的配置
  function createNodeToNeverTranslateLangsList(langCode, langName) { // 创建"永不翻译语言"列表项
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container"); // 容器类
    li.value = langCode; // 保存语言代码
    li.textContent = langName; // 显示语言名称

    const close = document.createElement("span"); // 删除按钮
    close.setAttribute("class", "w3-button w3-transparent w3-display-right"); // 样式类
    close.innerHTML = "&times;"; // 叉号符号

    close.onclick = (e) => { // 点击删除
      e.preventDefault();

      twpConfig.removeLangFromNeverTranslate(langCode); // 从配置移除
      li.remove(); // 从 DOM 移除
    };

    li.appendChild(close); // 挂载按钮

    return li; // 返回 DOM 节点
  }

  const neverTranslateLangs = twpConfig.get("neverTranslateLangs"); // 获取"永不翻译"语言数组
  neverTranslateLangs.sort((a, b) => a?.localeCompare?.(b)); // 排序
  neverTranslateLangs.forEach((langCode) => { // 渲染列表
    const langName = twpLang.codeToLanguage(langCode); // 代码转名称
    const li = createNodeToNeverTranslateLangsList(langCode, langName); // 创建 LI
    $("#neverTranslateLangs").appendChild(li); // 插入 DOM
  });

  $("#addToNeverTranslateLangs").onchange = (e) => { // 添加"永不翻译"语言事件
    const langCode = e.target.value; // 选择的语言代码
    const langName = twpLang.codeToLanguage(langCode); // 转换名称
    const li = createNodeToNeverTranslateLangsList(langCode, langName); // 创建节点
    $("#neverTranslateLangs").appendChild(li); // 插入 DOM

    twpConfig.addLangToNeverTranslate(langCode); // 写入配置
  };

  // 总是翻译语言列表的配置
  function createNodeToAlwaysTranslateLangsList(langCode, langName) { // 创建"总是翻译语言"列表项
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container");
    li.value = langCode;
    li.textContent = langName;

    const close = document.createElement("span");
    close.setAttribute("class", "w3-button w3-transparent w3-display-right");
    close.innerHTML = "&times;";

    close.onclick = (e) => { // 删除事件
      e.preventDefault();

      twpConfig.removeLangFromAlwaysTranslate(langCode); // 移除配置
      li.remove();
    };

    li.appendChild(close);

    return li;
  }

  const alwaysTranslateLangs = twpConfig.get("alwaysTranslateLangs"); // 获取"总是翻译"语言数组
  alwaysTranslateLangs.sort((a, b) => a?.localeCompare?.(b)); // 排序
  alwaysTranslateLangs.forEach((langCode) => { // 渲染
    const langName = twpLang.codeToLanguage(langCode);
    const li = createNodeToAlwaysTranslateLangsList(langCode, langName);
    $("#alwaysTranslateLangs").appendChild(li);
  });

  $("#addToAlwaysTranslateLangs").onchange = (e) => { // 添加事件
    const langCode = e.target.value;
    const langName = twpLang.codeToLanguage(langCode);
    const li = createNodeToAlwaysTranslateLangsList(langCode, langName);
    $("#alwaysTranslateLangs").appendChild(li);

    twpConfig.addLangToAlwaysTranslate(langCode); // 写入配置
  };

  // 悬停翻译语言列表的配置
  function createNodeToLangsToTranslateWhenHoveringList(langCode, langName) { // 创建悬停翻译语言列表项
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container");
    li.value = langCode;
    li.textContent = langName;

    const close = document.createElement("span");
    close.setAttribute("class", "w3-button w3-transparent w3-display-right");
    close.innerHTML = "&times;";

    close.onclick = (e) => { // 删除事件
      e.preventDefault();

      twpConfig.removeLangFromTranslateWhenHovering(langCode); // 从配置移除
      li.remove();
    };

    li.appendChild(close);

    return li;
  }

  const langsToTranslateWhenHovering = twpConfig.get(
    "langsToTranslateWhenHovering"
  ); // 获取悬停翻译语言数组
  langsToTranslateWhenHovering.sort((a, b) => a?.localeCompare?.(b)); // 排序
  langsToTranslateWhenHovering.forEach((langCode) => { // 渲染
    const langName = twpLang.codeToLanguage(langCode);
    const li = createNodeToLangsToTranslateWhenHoveringList(langCode, langName);
    $("#langsToTranslateWhenHovering").appendChild(li);
  });

  $("#addLangToTranslateWhenHovering").onchange = (e) => { // 新增事件
    const langCode = e.target.value;
    const langName = twpLang.codeToLanguage(langCode);
    const li = createNodeToLangsToTranslateWhenHoveringList(langCode, langName);
    $("#langsToTranslateWhenHovering").appendChild(li);

    twpConfig.addLangToTranslateWhenHovering(langCode); // 写入配置
  };

  // 总是翻译站点列表的配置
  function createNodeToAlwaysTranslateSitesList(hostname) { // 创建总是翻译站点列表项
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container");
    li.value = hostname; // 存主机名
    li.textContent = hostname; // 显示主机名

    const close = document.createElement("span");
    close.setAttribute("class", "w3-button w3-transparent w3-display-right");
    close.innerHTML = "&times;";

    close.onclick = (e) => { // 删除站点
      e.preventDefault();

      twpConfig.removeSiteFromAlwaysTranslate(hostname); // 配置移除
      li.remove();
    };

    li.appendChild(close);

    return li;
  }

  const alwaysTranslateSites = twpConfig.get("alwaysTranslateSites"); // 获取"总是翻译站点"数组
  alwaysTranslateSites.sort((a, b) => a?.localeCompare?.(b)); // 字母排序
  alwaysTranslateSites.forEach((hostname) => { // 渲染
    const li = createNodeToAlwaysTranslateSitesList(hostname);
    $("#alwaysTranslateSites").appendChild(li);
  });

  $("#addToAlwaysTranslateSites").onclick = (e) => { // 添加站点按钮
    const hostname = prompt("Enter the site hostname", "www.site.com"); // 提示输入
    if (!hostname) return; // 取消直接返回

    const li = createNodeToAlwaysTranslateSitesList(hostname); // 创建节点
    $("#alwaysTranslateSites").appendChild(li); // 插入

    twpConfig.addSiteToAlwaysTranslate(hostname); // 写配置
  };

  // 永不翻译站点列表的配置

  function createNodeToNeverTranslateSitesList(hostname) { // 创建永不翻译站点列表项
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container");
    li.value = hostname;
    li.textContent = hostname;

    const close = document.createElement("span");
    close.setAttribute("class", "w3-button w3-transparent w3-display-right");
    close.innerHTML = "&times;";

    close.onclick = (e) => { // 删除事件
      e.preventDefault();

      twpConfig.removeSiteFromNeverTranslate(hostname); // 配置移除
      li.remove();
    };

    li.appendChild(close);

    return li;
  }

  const neverTranslateSites = twpConfig.get("neverTranslateSites"); // 获取永不翻译站点数组
  neverTranslateSites.sort((a, b) => a?.localeCompare?.(b)); // 排序
  neverTranslateSites.forEach((hostname) => { // 渲染
    const li = createNodeToNeverTranslateSitesList(hostname);
    $("#neverTranslateSites").appendChild(li);
  });

  $("#addToNeverTranslateSites").onclick = (e) => { // 添加永不翻译站点
    const hostname = prompt("Enter the site hostname", "www.site.com");
    if (!hostname) return;

    const li = createNodeToNeverTranslateSitesList(hostname);
    $("#neverTranslateSites").appendChild(li);

    twpConfig.addSiteToNeverTranslate(hostname); // 写配置
  };

  // 自定义词典配置
  function createcustomDictionary(keyWord, customValue) { // 创建自定义词典条目显示
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container");
    li.value = keyWord; // 保存关键字
    if (customValue !== "") {
      li.textContent = keyWord + " ------------------- " + customValue; // 显示映射
    } else {
      li.textContent = keyWord; // 仅显示关键词
    }
    const close = document.createElement("span"); // 删除按钮
    close.setAttribute("class", "w3-button w3-transparent w3-display-right");
    close.innerHTML = "&times;";

    close.onclick = (e) => { // 删除词条
      e.preventDefault();
      twpConfig.removeKeyWordFromcustomDictionary(keyWord); // 配置移除
      li.remove();
    };
    li.appendChild(close);
    return li;
  }

  let customDictionary = twpConfig.get("customDictionary"); // 获取自定义词典（Map）
  customDictionary = new Map( // 重新构造排序后的 Map
    [...customDictionary.entries()].sort((a, b) =>
      String(a[0])?.localeCompare?.(String(b[0]))
    )
  );
  customDictionary.forEach(function (customValue, keyWord) { // 渲染词典列表
    const li = createcustomDictionary(keyWord, customValue);
    $("#customDictionary").appendChild(li);
  });

  $("#addToCustomDictionary").onclick = (e) => { // 添加自定义词条
    let keyWord = prompt("Enter the keyWord, Minimum two letters ", ""); // 输入关键字
    if (!keyWord || keyWord.length < 2) return; // 长度不足返回
    keyWord = keyWord.trim().toLowerCase(); // 标准化处理
    let customValue = prompt(
      "(Optional)\nYou can enter a value to replace it , or fill in nothing.",
      ""
    ); // 可选替换值
    if (!customValue) customValue = ""; // 为空使用空串
    customValue = customValue.trim(); // 去空格
    const li = createcustomDictionary(keyWord, customValue); // 创建节点
    $("#customDictionary").appendChild(li); // 插入
    twpConfig.addKeyWordTocustomDictionary(keyWord, customValue); // 写配置
  };

  // 悬停翻译站点列表的配置

  function createNodeToSitesToTranslateWhenHoveringList(hostname) { // 创建悬停翻译站点条目
    const li = document.createElement("li");
    li.setAttribute("class", "w3-display-container");
    li.value = hostname;
    li.textContent = hostname;

    const close = document.createElement("span");
    close.setAttribute("class", "w3-button w3-transparent w3-display-right");
    close.innerHTML = "&times;";

    close.onclick = (e) => { // 删除事件
      e.preventDefault();

      twpConfig.removeSiteFromTranslateWhenHovering(hostname); // 配置移除
      li.remove();
    };

    li.appendChild(close);

    return li;
  }

  const sitesToTranslateWhenHovering = twpConfig.get(
    "sitesToTranslateWhenHovering"
  ); // 获取悬停翻译站点数组
  sitesToTranslateWhenHovering.sort((a, b) => a?.localeCompare?.(b)); // 排序
  sitesToTranslateWhenHovering.forEach((hostname) => { // 渲染
    const li = createNodeToSitesToTranslateWhenHoveringList(hostname);
    $("#sitesToTranslateWhenHovering").appendChild(li);
  });

  $("#addSiteToTranslateWhenHovering").onclick = (e) => { // 添加悬停翻译站点
    const hostname = prompt("Enter the site hostname", "www.site.com");
    if (!hostname) return;

    const li = createNodeToSitesToTranslateWhenHoveringList(hostname);
    $("#sitesToTranslateWhenHovering").appendChild(li);

    twpConfig.addSiteToTranslateWhenHovering(hostname); // 写配置
  };

  // 翻译行为相关配置
  $("#translateLongerThan").value = twpConfig.get("translateLongerThan"); // 初始化"长度大于 X 翻译"阈值
  $("#translateLongerThan").onchange = (e) => { // 修改阈值
    twpConfig.set("translateLongerThan", e.target.value);
  };

  $("#whereToDisplayTranslatedText").onchange = (e) => { // 译文显示位置变更
    twpConfig.set("whereToDisplayTranslatedText", e.target.value);
  };
  $("#whereToDisplayTranslatedText").value = twpConfig.get("whereToDisplayTranslatedText"); // 初始化译文显示位置

  $("#aiImproveForLongerThan").value = twpConfig.get("aiImproveForLongerThan"); // AI 改进阈值初始化
  $("#aiImproveForLongerThan").onchange = (e) => { // 修改
    twpConfig.set("aiImproveForLongerThan", e.target.value);
  };

  $("#autoImproveByAI").onchange = (e) => { // 是否自动 AI 改进
    twpConfig.set("autoImproveByAI", e.target.value);
  };
  $("#autoImproveByAI").value = twpConfig.get("autoImproveByAI"); // 初始化值

  $("#enableAiTranslationCache").onchange = (e) => { // 是否启用 AI 翻译缓存
    twpConfig.set("enableAiTranslationCache", e.target.value);
  };
  $("#enableAiTranslationCache").value = twpConfig.get("enableAiTranslationCache") || "yes"; // 初始化值（默认开启）

  const aiProviderSelect = $("#aiProvider");
  const aiOptionsController = createAiOptionsController({
    root: document,
    aiProviderSelect,
    config: twpConfig,
    refreshCurrentProvider: (provider) => {
      switch (provider) {
        case "openai":
          if (typeof populateOpenAiModels === "function" && openAiModelSelect) {
            const key = apiKeyOpenAIInput ? apiKeyOpenAIInput.value : (twpConfig.get("apiKeyOpenAI") || "");
            const stored = twpConfig.get("openAiModel") || "";
            populateOpenAiModels(openAiModelSelect, key, stored, fallbackOpenAiOptions);
          }
          break;
        case "openrouter":
          if (typeof populateOpenRouterModels === "function" && openRouterModelSelect) {
            const stored = twpConfig.get("openRouterModel") || "";
            const fallback = openRouterModelSelect ? Array.from(openRouterModelSelect.options || []).map((o) => ({ value: o.value, text: o.textContent })) : [];
            populateOpenRouterModels(openRouterModelSelect, twpConfig.get("openRouterApiBase") || "", stored, fallback);
          }
          break;
        case "anthropic":
          if (typeof populateAnthropicModels === "function" && anthropicModelSelect) {
            const key = apiKeyAnthropicInput ? apiKeyAnthropicInput.value : (twpConfig.get("apiKeyAnthropic") || "");
            const stored = twpConfig.get("anthropicModel") || "";
            populateAnthropicModels(anthropicModelSelect, key, stored, fallbackAnthropicOptions);
          }
          break;
        case "google-gemini":
          if (typeof populateGoogleGeminiModels === "function" && googleGeminiModelSelect) {
            const key = apiKeyGoogleGeminiInput ? apiKeyGoogleGeminiInput.value : (twpConfig.get("apiKeyGoogleGemini") || "");
            const stored = twpConfig.get("googleGeminiModel") || "";
            populateGoogleGeminiModels(googleGeminiModelSelect, key, stored, fallbackGoogleGeminiOptions);
          }
          break;
        case "azure-openai":
          if (typeof populateAzureOpenAIModels === "function" && azureOpenAIModelSelect) {
            const key = apiKeyAzureOpenAIInput ? apiKeyAzureOpenAIInput.value : (twpConfig.get("apiKeyAzureOpenAI") || "");
            const endpoint = azureOpenAIEndpointInput ? azureOpenAIEndpointInput.value : (twpConfig.get("azureOpenAIEndpoint") || "");
            const stored = twpConfig.get("azureOpenAIModel") || "";
            populateAzureOpenAIModels(azureOpenAIModelSelect, key, endpoint, stored, fallbackAzureOpenAIOptions);
          }
          break;
        case "deepseek":
          if (typeof populateDeepSeekModels === "function" && deepSeekModelSelect) {
            const key = apiKeyDeepSeekInput ? apiKeyDeepSeekInput.value : (twpConfig.get("apiKeyDeepSeek") || "");
            const stored = twpConfig.get("deepSeekModel") || "";
            populateDeepSeekModels(deepSeekModelSelect, key, stored, fallbackDeepSeekOptions);
          }
          break;
        case "grok":
          if (typeof populateGrokModels === "function" && grokModelSelect) {
            const key = apiKeyGrokInput ? apiKeyGrokInput.value : (twpConfig.get("apiKeyGrok") || "");
            const stored = twpConfig.get("grokModel") || "";
            populateGrokModels(grokModelSelect, key, stored, fallbackGrokOptions);
          }
          break;
        default:
          break;
      }
    },
    refreshers: {
      openai: () => {
        if ($("#openAiModel") && typeof populateOpenAiModels === "function") {
          const select = $("#openAiModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          populateOpenAiModels(select, twpConfig.get("apiKeyOpenAI") || "", twpConfig.get("openAiModel") || "", fallback);
        }
      },
      googleGemini: () => {
        if ($("#googleGeminiModel") && typeof populateGoogleGeminiModels === "function") {
          const select = $("#googleGeminiModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          populateGoogleGeminiModels(select, twpConfig.get("apiKeyGoogleGemini") || "", twpConfig.get("googleGeminiModel") || "", fallback);
        }
      },
      anthropic: () => {
        if ($("#anthropicModel") && typeof populateAnthropicModels === "function") {
          const select = $("#anthropicModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          populateAnthropicModels(select, twpConfig.get("apiKeyAnthropic") || "", twpConfig.get("anthropicModel") || "", fallback);
        }
      },
      azureOpenAI: () => {
        if ($("#azureOpenAIModel") && typeof populateAzureOpenAIModels === "function") {
          const select = $("#azureOpenAIModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          const apiKey = $("#apiKeyAzureOpenAI") ? $("#apiKeyAzureOpenAI").value : (twpConfig.get("apiKeyAzureOpenAI") || "");
          const endpoint = $("#azureOpenAIEndpoint") ? $("#azureOpenAIEndpoint").value : (twpConfig.get("azureOpenAIEndpoint") || "");
          populateAzureOpenAIModels(select, apiKey, endpoint, twpConfig.get("azureOpenAIModel") || "", fallback);
        }
      },
      deepseek: () => {
        if ($("#deepSeekModel") && typeof populateDeepSeekModels === "function") {
          const select = $("#deepSeekModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          populateDeepSeekModels(select, twpConfig.get("apiKeyDeepSeek") || "", twpConfig.get("deepSeekModel") || "", fallback);
        }
      },
      grok: () => {
        if ($("#grokModel") && typeof populateGrokModels === "function") {
          const select = $("#grokModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          populateGrokModels(select, twpConfig.get("apiKeyGrok") || "", twpConfig.get("grokModel") || "", fallback);
        }
      },
      openrouter: () => {
        if ($("#openRouterModel") && typeof populateOpenRouterModels === "function") {
          const select = $("#openRouterModel");
          const fallback = Array.from(select.options || []).map((o) => ({ value: o.value, text: o.textContent }));
          populateOpenRouterModels(select, twpConfig.get("openRouterApiBase") || "", twpConfig.get("openRouterModel") || "", fallback);
        }
      },
    },
  });
  if (aiProviderSelect) {
    aiOptionsController.initialize();
    aiProviderSelect.onchange = (e) => {
      aiOptionsController.handleProviderChange(e.target.value);
    };
  }
  // 当配置在其它地方（例如弹出窗口或后台页）被修改时，保持 options 页面 UI 同步
  // 例如：在扩展其它页面修改了 aiProvider 或 API key，则在 options 页面也应立即切换到对应的设置面板或刷新模型列表
  if (typeof twpConfig.onChanged === "function") {
    twpConfig.onChanged((name, newValue) => {
      console.debug("twpConfig.onChanged event:", name, newValue);
      try {
        const handledByAiSync = aiOptionsController.handleConfigChanged(name, newValue);
        if (handledByAiSync) {
          return;
        }

        switch (name) {
          case "openRouterApiBase":
          case "openRouterReferer":
          case "openRouterTitle":
            break;
          default:
            // 未处理的配置项忽略
            break;
        }
      } catch (err) {
        console.warn("twpConfig.onChanged handler error:", err);
      }
    });
  }

  // 额外监听 storage 变化，作为保险(如果 twpConfig.onChanged 在某些情况下没有被调用)
  if (typeof chrome !== "undefined" && chrome.storage && typeof chrome.storage.onChanged !== "undefined") {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      aiOptionsController.handleStorageChanged(changes, areaName);
    });
  }


  // Google Gemini模型下拉框自动填充（提前声明，避免未定义）
  async function populateGoogleGeminiModels(select, apiKey, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) return;
    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    const sanitizedKey = (apiKey || "").trim();
    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        missingConfigNotice: !sanitizedKey
          ? i18nOrDefault("msgEnterApiKeyForModels", "Please enter API key to get available models for this provider")
          : "",
        loadOptions: () => loadAiProviderModelOptions({
          provider: "google-gemini",
          apiKey: sanitizedKey,
          translate: i18nOrDefault,
        }),
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
        errorToNotice: (error) =>
          error instanceof Error && error.message
            ? error.message
            : i18nOrDefault("msgCannotLoadGoogleGeminiModelsHttp", "Unable to load Google Gemini models"),
      });
    } catch (error) {
      console.warn("无法从API加载Google Gemini模型:", error);
    }
  }
  const openAiModelSelect = $("#openAiModel");
  const fallbackOpenAiOptions = openAiModelSelect
    ? Array.from(openAiModelSelect.options || []).map((option) => ({
        value: option.value,
        text: option.textContent,
      }))
    : [];
  const storedOpenAiModel = twpConfig.get("openAiModel") || "";
  const storedApiKeyOpenAI = (twpConfig.get("apiKeyOpenAI") || "").trim();
  if (storedApiKeyOpenAI !== (twpConfig.get("apiKeyOpenAI") || "")) {
    twpConfig.set("apiKeyOpenAI", storedApiKeyOpenAI);
  }
  const apiKeyOpenAIInput = $("#apiKeyOpenAI");
  if (apiKeyOpenAIInput) {
    apiKeyOpenAIInput.value = storedApiKeyOpenAI;
    apiKeyOpenAIInput.onchange = (e) => {
      const newKey = (e.target.value || "").trim();
      apiKeyOpenAIInput.value = newKey;
      twpConfig.set("apiKeyOpenAI", newKey);
      if (openAiModelSelect) {
        const selectedModel =
          openAiModelSelect.value || twpConfig.get("openAiModel") || "";
        populateOpenAiModels(
          openAiModelSelect,
          newKey,
          selectedModel,
          fallbackOpenAiOptions
        );
      }
    };
  }
  if (openAiModelSelect) {
    populateOpenAiModels(
      openAiModelSelect,
      storedApiKeyOpenAI,
      storedOpenAiModel,
      fallbackOpenAiOptions
    );
    openAiModelSelect.onchange = (e) => {
      twpConfig.set("openAiModel", e.target.value);
    };
  }

  // Google Gemini模型下拉框自动填充
  const googleGeminiModelSelect = $("#googleGeminiModel");
  const fallbackGoogleGeminiOptions = googleGeminiModelSelect
    ? Array.from(googleGeminiModelSelect.options || []).map((option) => ({
        value: option.value,
        text: option.textContent,
      }))
    : [];
  const storedGoogleGeminiModel = twpConfig.get("googleGeminiModel") || "";
  const apiKeyGoogleGeminiInput = $("#apiKeyGoogleGemini");
  const storedApiKeyGoogleGemini = (twpConfig.get("apiKeyGoogleGemini") || "").trim();
  if (apiKeyGoogleGeminiInput) {
    apiKeyGoogleGeminiInput.value = storedApiKeyGoogleGemini;
    apiKeyGoogleGeminiInput.onchange = (e) => {
      const newKey = (e.target.value || "").trim();
      apiKeyGoogleGeminiInput.value = newKey;
      twpConfig.set("apiKeyGoogleGemini", newKey);
      if (googleGeminiModelSelect) {
        const selectedModel =
          googleGeminiModelSelect.value || twpConfig.get("googleGeminiModel") || "";
        populateGoogleGeminiModels(
          googleGeminiModelSelect,
          newKey,
          selectedModel,
          fallbackGoogleGeminiOptions
        );
      }
    };
  }
  if (googleGeminiModelSelect) {
    populateGoogleGeminiModels(
      googleGeminiModelSelect,
      storedApiKeyGoogleGemini,
      storedGoogleGeminiModel,
      fallbackGoogleGeminiOptions
    );
    googleGeminiModelSelect.onchange = (e) => {
      twpConfig.set("googleGeminiModel", e.target.value);
    };
  }

  const apiKeyOpenRouterInput = $("#apiKeyOpenRouter");
  if (apiKeyOpenRouterInput) {
    apiKeyOpenRouterInput.value = twpConfig.get("apiKeyOpenRouter") || "";
    apiKeyOpenRouterInput.onchange = (e) => {
      twpConfig.set("apiKeyOpenRouter", e.target.value);
    };
  }

  async function populateGoogleGeminiModels(select, apiKey, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) return;
    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    select.disabled = true;
    select.innerHTML = "";
    const loadingOption = document.createElement("option");
    loadingOption.value = "";
    loadingOption.textContent = "Loading...";
    loadingOption.disabled = true;
    loadingOption.selected = true;
    select.appendChild(loadingOption);
    const sanitizedKey = (apiKey || "").trim();
    if (!sanitizedKey) {
      // 无 API Key：使用预览（OpenRouter → 静态列表 fallback）
      try {
        const previewModels = await loadPreviewModels({ provider: "google-gemini" });
        select.innerHTML = "";
        previewModels.forEach((model) => {
          const option = document.createElement("option");
          option.value = model.value;
          option.textContent = model.text;
          select.appendChild(option);
        });
        fallback.splice(0, fallback.length, ...previewModels);
      } catch (_) {
        select.innerHTML = "";
        fallback.forEach((item) => {
          const option = document.createElement("option");
          option.value = item.value;
          option.textContent = item.text;
          select.appendChild(option);
        });
      }
      select.disabled = false;
      if (storedValue) select.value = storedValue;
      if (!select.value) {
        const firstEnabled = Array.from(select.options).find((opt) => !opt.disabled);
        if (firstEnabled) select.value = firstEnabled.value;
      }
      return;
    }
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${sanitizedKey}`);
      if (!response.ok) {
        let message = i18nOrDefault("msgCannotLoadGoogleGeminiModelsHttp", `无法加载Google Gemini模型 (HTTP ${response.status})`);
        try {
          const errorPayload = await response.json();
          if (errorPayload?.error?.message) {
            message = errorPayload.error.message;
          }
        } catch (jsonError) {}
        throw new Error(message);
      }
      const payload = await response.json();
      const models = Array.isArray(payload?.models) ? payload.models : [];
      if (!models.length) throw new Error("Google Gemini模型列表为空");
      models.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
      select.innerHTML = "";
      models.forEach((model) => {
        if (!model || !model.name) return;
        const option = document.createElement("option");
        option.value = model.name;
        option.textContent = model.displayName || model.name;
        select.appendChild(option);
      });
      if (storedValue && !models.some((model) => model?.name === storedValue)) {
        const preservedOption = document.createElement("option");
        preservedOption.value = storedValue;
        preservedOption.textContent = storedValue;
        select.appendChild(preservedOption);
      }
    } catch (error) {
      console.warn("无法从API加载Google Gemini模型:", error);
      select.innerHTML = "";
      fallback.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.text;
        select.appendChild(option);
      });
    } finally {
      select.disabled = false;
      if (storedValue) select.value = storedValue;
      if (!select.value && select.options.length > 0) select.selectedIndex = 0;
    }
  }
  async function populateOpenAiModels(select, apiKey, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) {
      return;
    }

    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];

    const sanitizedKey = (apiKey || "").trim();

    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        smartDefaultProvider: "openai",
        missingConfigNotice: "",
        loadOptions: sanitizedKey
          ? () => loadAiProviderModelOptions({
              provider: "openai",
              apiKey: sanitizedKey,
              translate: i18nOrDefault,
            })
          : () => loadPreviewModels({ provider: "openai" }),
        errorToNotice: (error) =>
          error instanceof Error && error.message
            ? error.message
            : "Unable to load OpenAI models",
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
      });
    } catch (error) {
      console.warn("Unable to load OpenAI models from API:", error);
    }
  }

  async function populateOpenRouterModels(select, apiBase, storedValue, fallbackOptions) {
    if (!select || select._isMissingElement) {
      return;
    }

    const fallback = Array.isArray(fallbackOptions) ? fallbackOptions : [];
    const sanitizedApiBase = (apiBase || "").trim();

    try {
      await refreshAiModelSelect({
        select,
        storedValue,
        fallbackOptions: fallback,
        loadOptions: () => loadAiProviderModelOptions({
          provider: "openrouter",
          endpoint: sanitizedApiBase,
        }),
        onLoadedOptions: (normalizedOptions) => {
          fallback.splice(0, fallback.length, ...normalizedOptions);
        },
      });
    } catch (error) {
      console.warn("Unable to load OpenRouter models from API:", error);
    }
  }

  const openRouterModelSelect = $("#openRouterModel");
  if (openRouterModelSelect) {
    const storedOpenRouterModel = twpConfig.get("openRouterModel") || "";
    const fallbackOpenRouterOptions = Array.from(
      openRouterModelSelect.options || []
    ).map((option) => ({
      value: option.value,
      text: option.textContent,
    }));

    populateOpenRouterModels(
      openRouterModelSelect,
      twpConfig.get("openRouterApiBase") || "",
      storedOpenRouterModel,
      fallbackOpenRouterOptions
    );

    openRouterModelSelect.onchange = (e) => {
      twpConfig.set("openRouterModel", e.target.value);
    };
  }

  const openRouterApiBaseInput = $("#openRouterApiBase");
  if (openRouterApiBaseInput) {
    openRouterApiBaseInput.value = twpConfig.get("openRouterApiBase") || "";
    openRouterApiBaseInput.onchange = (e) => {
      const nextValue = (e.target.value || "").trim();
      openRouterApiBaseInput.value = nextValue;
      twpConfig.set("openRouterApiBase", nextValue);
      if (openRouterModelSelect) {
        populateOpenRouterModels(
          openRouterModelSelect,
          nextValue,
          openRouterModelSelect.value || twpConfig.get("openRouterModel") || "",
          Array.from(openRouterModelSelect.options || []).map((option) => ({
            value: option.value,
            text: option.textContent,
          }))
        );
      }
    };
  }

  const openRouterRefererInput = $("#openRouterReferer");
  if (openRouterRefererInput) {
    openRouterRefererInput.value = twpConfig.get("openRouterReferer") || "";
    openRouterRefererInput.onchange = (e) => {
      twpConfig.set("openRouterReferer", e.target.value);
    };
  }

  const openRouterTitleInput = $("#openRouterTitle");
  if (openRouterTitleInput) {
    openRouterTitleInput.value = twpConfig.get("openRouterTitle") || "";
    openRouterTitleInput.onchange = (e) => {
      twpConfig.set("openRouterTitle", e.target.value);
    };
  }

  // 各 provider 的自定义端点输入
  for (const [id, configKey] of [
    ["openAiApiBase", "openAiApiBase"],
    ["anthropicApiBase", "anthropicApiBase"],
    ["googleGeminiApiBase", "googleGeminiApiBase"],
    ["deepSeekApiBase", "deepSeekApiBase"],
    ["grokApiBase", "grokApiBase"],
  ]) {
    const input = $("#" + id);
    if (input) {
      input.value = twpConfig.get(configKey) || "";
      input.onchange = (e) => {
        twpConfig.set(configKey, (e.target.value || "").trim());
      };
    }
  }

  // 统一为所有 API Key 输入设置 i18n placeholder
  const apiKeyPlaceholder = chrome.i18n.getMessage("lblEnterApiKey") || "Enter API key";
  for (const id of [
    "apiKeyOpenAI", "apiKeyOpenRouter", "apiKeyAnthropic", "apiKeyGoogleGemini",
    "apiKeyAzureOpenAI", "apiKeyDeepSeek", "apiKeyGrok", "apiKeyGeneric",
  ]) {
    const input = $("#" + id);
    if (input && !input.placeholder) {
      input.placeholder = apiKeyPlaceholder;
    }
  }

  // 仅暴露当前支持的免费网页翻译引擎，并将历史不兼容值回退到 google。
  $("#pageTranslatorService").onchange = (e) => {
    twpConfig.set("pageTranslatorService", e.target.value);
  };
  const currentPageTranslatorService = twpConfig.get("pageTranslatorService");
  $("#pageTranslatorService").value = ["google", "microsoft"].includes(currentPageTranslatorService)
    ? currentPageTranslatorService
    : "google";

  // $("#textTranslatorService").onchange = (e) => {
  //   twpConfig.set("textTranslatorService", e.target.value);
  // };
  // $("#textTranslatorService").value = twpConfig.get("textTranslatorService");

  $("#ttsSpeed").oninput = (e) => { // TTS 语速滑块实时更新
    twpConfig.set("ttsSpeed", e.target.value);
    $("#displayTtsSpeed").textContent = e.target.value; // 显示当前值
  };
  $("#ttsSpeed").value = twpConfig.get("ttsSpeed"); // 初始化语速
  $("#displayTtsSpeed").textContent = twpConfig.get("ttsSpeed"); // 显示初始语速

  $("#showOriginalTextWhenHovering").onchange = (e) => { // 悬停显示原文开关
    twpConfig.set("showOriginalTextWhenHovering", e.target.value);
  };
  $("#showOriginalTextWhenHovering").value = twpConfig.get(
    "showOriginalTextWhenHovering"
  ); // 初始化

  $("#translateTag_pre").onchange = (e) => { // 是否翻译 <pre> 标签内容
    twpConfig.set("translateTag_pre", e.target.value);
  };
  $("#translateTag_pre").value = twpConfig.get("translateTag_pre"); // 初始化

  $("#enableDeepL").onchange = (e) => { // DeepL 翻译开关变更
    twpConfig.set("enableDeepL", e.target.value);
  };
  $("#enableDeepL").value = twpConfig.get("enableDeepL"); // 初始化 DeepL 开关状态

  $("#dontSortResults").onchange = (e) => { // 是否不对翻译结果排序
    twpConfig.set("dontSortResults", e.target.value);
  };
  $("#dontSortResults").value = twpConfig.get("dontSortResults"); // 初始化

  $("#translateDynamicallyCreatedContent").onchange = (e) => { // 是否翻译动态创建内容
    twpConfig.set("translateDynamicallyCreatedContent", e.target.value);
  };
  $("#translateDynamicallyCreatedContent").value = twpConfig.get(
    "translateDynamicallyCreatedContent"
  ); // 初始化

  $("#autoTranslateWhenClickingALink").onchange = (e) => { // 点击链接自动翻译开关
    if (e.target.value == "yes") { // 需要申请 webNavigation 权限
      chrome.permissions.request(
        {
          permissions: ["webNavigation"], // 申请权限
        },
        (granted) => { // 回调处理
          if (granted) {
            twpConfig.set("autoTranslateWhenClickingALink", "yes"); // 授予更新配置
          } else {
            twpConfig.set("autoTranslateWhenClickingALink", "no"); // 否则回退
            e.target.value = "no"; // 同步 UI
          }
        }
      );
    } else { // 关闭时移除权限
      twpConfig.set("autoTranslateWhenClickingALink", "no");
      chrome.permissions.remove({
        permissions: ["webNavigation"], // 释放权限
      });
    }
  };
  $("#autoTranslateWhenClickingALink").value = twpConfig.get(
    "autoTranslateWhenClickingALink"
  ); // 初始化

  // if (twpConfig.get("enableDeepL") === "yes") {
  //   $('#textTranslatorService option[value="deepl"]').removeAttribute("hidden");
  // } else {
  //   $('#textTranslatorService option[value="deepl"]').setAttribute(
  //     "hidden",
  //     ""
  //   );
  // }
  // twpConfig.onChanged((name, newvalue) => {
  //   switch (name) {
  //     case "enableDeepL":
  //       if (newvalue === "yes") {
  //         $('#textTranslatorService option[value="deepl"]').removeAttribute(
  //           "hidden"
  //         );
  //       } else {
  //         twpConfig.set("textTranslatorService", "google");
  //         $("#textTranslatorService").value = "google";
  //         $('#textTranslatorService option[value="deepl"]').setAttribute(
  //           "hidden",
  //           ""
  //         );
  //       }
  //       break;
  //   }
  // });

  /**
   * 根据开关使能/禁用高级选项
   * @param {*} value 
   */
  function enableOrDisableTranslateSelectedAdvancedOptions(value) { 
    if (value === "no") {
      document
        .querySelectorAll("#translateSelectedAdvancedOptions input")
        .forEach((input) => {
          input.setAttribute("disabled", ""); // 禁用输入
        });
    } else {
      document
        .querySelectorAll("#translateSelectedAdvancedOptions input")
        .forEach((input) => {
          input.removeAttribute("disabled"); // 解除禁用
        });
    }
  }

  // 悬浮翻译按钮开关及其高级选项
  $("#showTranslateSelectedButton").onchange = (e) => { 
    twpConfig.set("showTranslateSelectedButton", e.target.value);
    enableOrDisableTranslateSelectedAdvancedOptions(e.target.value); // 同步高级选项状态
  };
  $("#showTranslateSelectedButton").value = twpConfig.get(
    "showTranslateSelectedButton"
  ); // 初始化
  enableOrDisableTranslateSelectedAdvancedOptions(
    twpConfig.get("showTranslateSelectedButton")
  ); // 初始设置高级选项可用状态

  $("#dontShowIfPageLangIsTargetLang").onchange = (e) => { // 页面语言与目标语言相同则不显示按钮
    twpConfig.set(
      "dontShowIfPageLangIsTargetLang",
      e.target.checked ? "yes" : "no"
    );
  };
  $("#dontShowIfPageLangIsTargetLang").checked =
    twpConfig.get("dontShowIfPageLangIsTargetLang") === "yes" ? true : false; // 初始化勾选状态

  $("#dontShowIfPageLangIsUnknown").onchange = (e) => { // 页面语言未知时不显示按钮
    twpConfig.set(
      "dontShowIfPageLangIsUnknown",
      e.target.checked ? "yes" : "no"
    );
  };
  $("#dontShowIfPageLangIsUnknown").checked =
    twpConfig.get("dontShowIfPageLangIsUnknown") === "yes" ? true : false; // 初始化

  $("#dontShowIfSelectedTextIsTargetLang").onchange = (e) => { // 选中文本已是目标语言则不显示
    twpConfig.set(
      "dontShowIfSelectedTextIsTargetLang",
      e.target.checked ? "yes" : "no"
    );
  };
  $("#dontShowIfSelectedTextIsTargetLang").checked =
    twpConfig.get("dontShowIfSelectedTextIsTargetLang") === "yes"
      ? true
      : false; // 初始化

  $("#dontShowIfSelectedTextIsUnknown").onchange = (e) => { // 选中文本语言未知则不显示
    twpConfig.set(
      "dontShowIfSelectedTextIsUnknown",
      e.target.checked ? "yes" : "no"
    );
  };
  $("#dontShowIfSelectedTextIsUnknown").checked =
    twpConfig.get("dontShowIfSelectedTextIsUnknown") === "yes" ? true : false; // 初始化

  // style options 样式/主题相关
  $("#useOldPopup").onchange = (e) => { // 弹窗样式变更
    twpConfig.set("useOldPopup", e.target.value);
    updateDarkMode();
  };
  $("#useOldPopup").value = twpConfig.get("useOldPopup"); // 初始化弹窗样式

  // 深色模式选项
  $("#darkMode").onchange = (e) => { 
    twpConfig.set("darkMode", e.target.value);
    updateDarkMode(); // 应用变更
  };
  $("#darkMode").value = twpConfig.get("darkMode"); // 初始化

  // 翻译后文字颜色取色器变更
  const googleTranslatedColorPicker = $("#translatedColorEyeDropper");
  const aiTranslatedColorPicker = $("#aiTranslatedColorEyeDropper");

  googleTranslatedColorPicker.addEventListener("change", (e) => {
    twpConfig.set("translatedColor", e.detail?.rgba || e.target.color || "");
  });
  googleTranslatedColorPicker.color = twpConfig.get("translatedColor");

  $("#resetTranslatedColor").addEventListener("click", () => {
    twpConfig.set("translatedColor", "");
    googleTranslatedColorPicker.color = "";
  });

  aiTranslatedColorPicker.addEventListener("change", (e) => {
    twpConfig.set("aiTranslatedColor", e.detail?.rgba || e.target.color || "");
  });
  aiTranslatedColorPicker.color = twpConfig.get("aiTranslatedColor");

  $("#resetAiTranslatedColor").addEventListener("click", () => {
    twpConfig.set("aiTranslatedColor", "");
    aiTranslatedColorPicker.color = "";
  });

  // 是否在整站翻译后显示蓝色 popup
  $("#popupBlueWhenSiteIsTranslated").onchange = (e) => { 
    twpConfig.set("popupBlueWhenSiteIsTranslated", e.target.value);
  };
  $("#popupBlueWhenSiteIsTranslated").value = twpConfig.get(
    "popupBlueWhenSiteIsTranslated"
  ); // 初始化

  // 快捷键配置
  function escapeHtml(unsafe) { // 简单 HTML 转义（未使用于上方输入，保留）
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  $('[data-i18n="lblTranslateSelectedWhenPressTwice"]').innerHTML = $(
    '[data-i18n="lblTranslateSelectedWhenPressTwice"]'
  ).innerHTML.replace("[Ctrl]", "<kbd>Ctrl</kbd>"); // 替换提示文本中 [Ctrl]
  $('[data-i18n="lblTranslateTextOverMouseWhenPressTwice"]').innerHTML = $(
    '[data-i18n="lblTranslateTextOverMouseWhenPressTwice"]'
  ).innerHTML.replace("[Ctrl]", "<kbd>Ctrl</kbd>"); // 同上

  $("#openNativeShortcutManager").onclick = (e) => { // 打开浏览器原生快捷键管理页
    chrome.tabs.create({
      url: "chrome://extensions/shortcuts",
    });
  };

  $("#translateSelectedWhenPressTwice").onclick = (e) => { // 双击 Ctrl 翻译选中文本开关
    twpConfig.set(
      "translateSelectedWhenPressTwice",
      e.target.checked ? "yes" : "no"
    );
  };
  $("#translateSelectedWhenPressTwice").checked =
    twpConfig.get("translateSelectedWhenPressTwice") === "yes"; // 初始化

  $("#translateTextOverMouseWhenPressTwice").onclick = (e) => { // 双击 Ctrl 翻译鼠标下文字开关
    twpConfig.set(
      "translateTextOverMouseWhenPressTwice",
      e.target.checked ? "yes" : "no"
    );
  };
  $("#translateTextOverMouseWhenPressTwice").checked =
    twpConfig.get("translateTextOverMouseWhenPressTwice") === "yes"; // 初始化

  const defaultShortcuts = {}; // 存放默认快捷键映射
  // 遍历 manifest 中注册的 commands，放入 defaultShortcuts 对象
  for (const name of Object.keys(chrome.runtime.getManifest().commands || {})) { 
    const info = chrome.runtime.getManifest().commands[name]; // 单个命令信息
    if (info.suggested_key && info.suggested_key.default) { // 如果有默认快捷键
      defaultShortcuts[name] = info.suggested_key.default; // 记录
    } else {
      defaultShortcuts[name] = ""; // 否则为空字符串
    }
  }

  // 是否允许在扩展自己的页面修改快捷键。Firefox下为true， Chromium (MV3) 为 false。Chromium只能通过浏览器原生入口修改
  const canUpdateBrowserShortcut = (typeof browser !== 'undefined') ? true : false;
  console.log(`浏览器支持 commands.update: ${canUpdateBrowserShortcut}`);
  const browserApi = (typeof browser !== 'undefined') ? browser : (typeof chrome !== 'undefined' ? chrome : undefined);
  // 对于fireFox，隐藏浏览器原生快捷键管理入口，显示扩展自己的快捷键界面；对于Chromium，反之
  if (canUpdateBrowserShortcut) { // fireFox
    console.log("Browser supports commands.update, can update browser-level shortcuts.");
    $("#openNativeShortcutManager").style.display = "none";
    $("#hotkeysListContainer").style.display = "block";
  } else { // Chromium
    console.log("Browser does not support commands.update, cannot update browser-level shortcuts.");
    $("#hotkeysListContainer").style.display = "none";
    $("#openNativeShortcutManager").style.display = "block";
  }

  /**
   * 从 browser.commands 获取已有的快捷键的信息, 并添加到页面
   * @param {*} hotkeyname 快捷键命令名称
   * @param {*} description 描述文本
   */
  function addHotkey(hotkeyname, description) { // 动态构建快捷键编辑 UI
    if (hotkeyname === "_execute_browser_action" && !description) { // 特殊命令默认描述
      description = "Enable the extension";
    }

    const li = document.createElement("li"); // 外层 LI
    li.classList.add("shortcut-row"); // 添加样式类
    li.setAttribute("id", hotkeyname); // 设定 id
    li.innerHTML = `
        <div>${description}</div>
        <div class="shortcut-input-options">
            <div style="position: relative;">
                <input name="input" class="w3-input w3-border shortcut-input" type="text" readonly placeholder="Enter a shortcut" data-i18n-placeholder="enterShortcut">
                <p name="error" class="shortcut-error" style="position: absolute;"></p>
            </div>
            <div class="w3-hover-light-grey shortcut-button" name="removeKey"><i class="gg-trash"></i></div>
            <div class="w3-hover-light-grey shortcut-button" name="resetKey"><i class="gg-sync"></i></div>
        </div>  
        `; // 模板字符串插入编辑区结构
    $("#KeyboardShortcuts").appendChild(li); // 插入快捷键列表容器

    const input = /** @type {HTMLInputElement} */ (li.querySelector(`[name="input"]`)); // 强制断言为输入框
    const error = /** @type {HTMLElement} */ (li.querySelector(`[name="error"]`)); // 错误提示元素
    const removeKey = /** @type {HTMLElement} */ (li.querySelector(`[name="removeKey"]`)); // 移除按钮元素
    const resetKey = /** @type {HTMLElement} */ (li.querySelector(`[name="resetKey"]`)); // 重置按钮元素

    // 运行时保护：若某元素未找到则直接返回避免后续空引用
    if(!input || !error || !removeKey || !resetKey){
      console.warn("Hotkey row elements missing for", hotkeyname);
      return;
    }

    input.value = twpConfig.get("hotkeys")[hotkeyname]; // 设置当前已存储的快捷键的显示值
    if (input.value) { // 如果有自定义值
      resetKey.style.display = "none"; // 隐藏"恢复默认"
    } else {
      removeKey.style.display = "none"; // 否则隐藏"移除"
    }

    function setError(errorname) { // 根据错误类型显示对应提示
      const text = chrome.i18n.getMessage("hotkeyError_" + errorname); // 从 i18n 获取本地化文本
      switch (errorname) { // 分类处理
        case "ctrlOrAlt":
          error.textContent = text ? text : "Include Ctrl or Alt"; // 必须包含 Ctrl 或 Alt
          break;
        case "letter":
          error.textContent = text ? text : "Type a letter"; // 需要输入字母/数字
          break;
        case "invalid":
          error.textContent = text ? text : "Invalid combination"; // 组合非法
          break;
        default:
          error.textContent = ""; // 清空错误
          break;
      }
    }

    /**
     * 将按键事件转为字符串形式
     * @param {*} e 
     * @returns 
     */
    function getKeyString(e) {
      let result = ""; // 初始空串
      if (e.ctrlKey) { // Ctrl 修饰符
        result += "Ctrl+";
      }
      if (e.altKey) { // Alt 修饰符
        result += "Alt+";
      }
      if (e.shiftKey) { // Shift 修饰符
        result += "Shift+";
      }
      if (e.code.match(/Key([A-Z])/)) { // 字母键
        result += e.code.match(/Key([A-Z])/)[1];
      } else if (e.code.match(/Digit([0-9])/)) { // 数字键
        result += e.code.match(/Digit([0-9])/)[1];
      }

      return result; // 返回组合串
    }

    /**
     * 保存快捷键到配置并通知浏览器
     * @param {*} name 
     * @param {*} keystring 
     */
    function setShortcut(name, keystring) { 
      const hotkeys = twpConfig.get("hotkeys"); // 读取当前映射
      hotkeys[hotkeyname] = keystring; // 更新指定命令快捷键
      twpConfig.set("hotkeys", hotkeys); // 写回配置
      // 只有 Firefox (或支持 commands.update 的浏览器) 才能真正更新浏览器层快捷键
      // @ts-ignore Firefox 支持 commands.update，Chromium 不支持
      if (canUpdateBrowserShortcut && browserApi?.commands && typeof browserApi.commands.update === 'function') {
        try {
          // @ts-ignore 类型定义中缺少 update，但在 Firefox 中可用
          browserApi.commands.update({
            name: name,
            shortcut: keystring,
          });
        } catch (err) {
          console.warn("commands.update 调用失败：", err);
        }
      } else {
        // Chromium 下无 commands.update，保留本地配置即可
      }
    }

    /**
     * 处理键盘按下/弹起事件
     * @param {*} e 
     * @returns 
     */
    function onkeychange(e) { 
      input.value = getKeyString(e); // 实时显示组合

      if (e.Key == "Tab") { // Tab 跳过
        return;
      }
      if (e.key == "Escape") { // Esc 取消输入
        input.blur();
        return;
      }
      if (e.key == "Backspace" || e.key == "Delete") { // 删除键即清除快捷键
        setShortcut(hotkeyname, getKeyString(e)); // 保存为空（因为组合为空串）
        input.blur(); // 失焦
        return;
      }
      if (!e.ctrlKey && !e.altKey) { // 未包含 Ctrl / Alt 则报错
        setError("ctrlOrAlt");
        return;
      }
      if (e.ctrlKey && e.altKey && e.shiftKey) { // 三修饰符同时被按下判定非法
        setError("invalid");
        return;
      }
      e.preventDefault(); // 阻止默认浏览器行为（避免触发快捷操作）
      if (!e.code.match(/Key([A-Z])/) && !e.code.match(/Digit([0-9])/)) { // 不是字母或数字
        setError("letter");
        return;
      }

      setShortcut(hotkeyname, getKeyString(e)); // 设置并保存快捷键
      input.blur(); // 输入结束

      setError("none"); // 清除错误
    }

    input.onkeydown = (e) => onkeychange(e); // 按下事件绑定
    input.onkeyup = (e) => onkeychange(e); // 弹起事件绑定

    input.onfocus = (e) => { // 聚焦时清空已显示值准备重新录入
      input.value = "";
      setError("");
    };

    input.onblur = (e) => { // 失焦恢复为已保存配置值
      input.value = twpConfig.get("hotkeys")[hotkeyname];
      setError("");
    };

    removeKey.onclick = (e) => { // 移除当前自定义快捷键
      input.value = ""; // 输入框清空
      setShortcut(hotkeyname, ""); // 保存为空

      removeKey.style.display = "none"; // 隐藏移除按钮
      resetKey.style.display = "block"; // 显示恢复默认按钮
    };

    resetKey.onclick = (e) => { // 恢复默认快捷键
      input.value = defaultShortcuts[hotkeyname]; // 显示默认
      setShortcut(hotkeyname, defaultShortcuts[hotkeyname]); // 保存默认

      removeKey.style.display = "block"; // 显示移除按钮
      resetKey.style.display = "none"; // 隐藏恢复按钮
    };

  }

  if (canUpdateBrowserShortcut && typeof chrome.commands !== "undefined") {
    chrome.commands.getAll((results) => {
      for (const result of results) {
        addHotkey(result.name, result.description);
      }
    });
  }

  // 存储/备份相关
  $("#deleteTranslationCache").onclick = (e) => { // 删除翻译缓存按钮
    if (confirm(chrome.i18n.getMessage("doYouWantToDeleteTranslationCache"))) { // 确认提示
      chrome.runtime.sendMessage({ // 发送消息通知后台删除缓存
        action: "deleteTranslationCache",
        reload: true,
      });
    }
  };

  $("#backupToFile").onclick = (e) => { // 备份配置到文件
    const configJSON = twpConfig.export(); // 导出 JSON 文本

    const element = document.createElement("a"); // 创建下载链接
    element.setAttribute(
      "href",
      "data:text/plain;charset=utf-8," + encodeURIComponent(configJSON)
    ); // 使用 data URL 触发下载
    element.setAttribute(
      "download",
      "twp-backup_" +
        new Date()
          .toISOString()
          .replace(/T/, "_")
          .replace(/\..+/, "")
          .replace(/\:/g, ".") +
        ".txt"
    ); // 命名包含时间戳

    element.style.display = "none"; // 隐藏临时元素
    document.body.appendChild(element); // 插入文档

    element.click(); // 触发点击下载

    document.body.removeChild(element); // 移除临时元素
  };
  $("#restoreFromFile").onclick = (e) => { // 从文件恢复配置
    const element = document.createElement("input"); // 文件选择 input
    element.setAttribute("type", "file");
    element.setAttribute("accept", "text/plain"); // 限制文本文件

    element.style.display = "none"; // 隐藏
    document.body.appendChild(element);

    element.oninput = (e) => { // 选择文件后事件
      const inputEl = /** @type {HTMLInputElement} */(e.target); // 断言为文件输入框
      const file = inputEl.files && inputEl.files[0]; // 获取第一份文件
      if(!file){ // 无文件直接返回
        return;
      }

      const reader = new FileReader(); // 创建文件读取器
      reader.onload = function () { // 读取完成回调
        try {
          const loaded = reader.result; // 读取结果（string | ArrayBuffer）
          let textContent = ""; // 统一后的文本内容
          if (typeof loaded === "string") { // 已经是字符串
            textContent = loaded;
          } else if (loaded instanceof ArrayBuffer) { // 转换 ArrayBuffer -> UTF-8 文本
            try {
              textContent = new TextDecoder("utf-8").decode(loaded);
            } catch (err) {
              console.warn("TextDecoder decode failed, fallback to manual conversion", err);
              const uint8 = new Uint8Array(loaded);
              textContent = Array.from(uint8).map(c => String.fromCharCode(c)).join("");
            }
          }
          if (
            confirm(chrome.i18n.getMessage("doYouWantOverwriteAllSettings"))
          ) { // 确认覆盖
            twpConfig.import(textContent); // 导入配置（保证是字符串）
          }
        } catch (e) { // 捕获错误
          alert(chrome.i18n.getMessage("fileIsCorrupted")); // 文件损坏提示
          console.error(e); // 控制台输出
        }
      };

      reader.readAsText(file); // 开始读取所选文件为文本
    };

    element.click(); // 触发文件选择

    document.body.removeChild(element); // 移除临时 input
  };
  $("#resetToDefault").onclick = (e) => { // 恢复默认设置
    if (confirm(chrome.i18n.getMessage("doYouWantRestoreSettings"))) { // 确认提示
      twpConfig.restoreToDefault(); // 重置配置
    }
  };

  $("#showPopupMobile").onchange = (e) => { // 移动端弹窗显示方式变更
    twpConfig.set("showPopupMobile", e.target.value);
  };
  $("#showPopupMobile").value = twpConfig.get("showPopupMobile"); // 初始化移动端弹窗设置

  $("#showFloatingBtn").onchange = (e) => { // 是否显示悬浮按钮
    twpConfig.set("showFloatingBtn", e.target.value);
  };
  $("#showFloatingBtn").value = twpConfig.get("showFloatingBtn"); // 初始化
  
  $("#showTranslatePageContextMenu").onchange = (e) => { // 页面翻译右键菜单开关
    twpConfig.set("showTranslatePageContextMenu", e.target.value);
  };
  $("#showTranslatePageContextMenu").value = twpConfig.get(
    "showTranslatePageContextMenu"
  ); // 初始化

  $("#showTranslateSelectedContextMenu").onchange = (e) => { // 选中文本翻译右键菜单开关
    twpConfig.set("showTranslateSelectedContextMenu", e.target.value);
  };
  $("#showTranslateSelectedContextMenu").value = twpConfig.get(
    "showTranslateSelectedContextMenu"
  ); // 初始化

  $("#showButtonInTheAddressBar").onchange = (e) => { // 地址栏按钮显示开关
    twpConfig.set("showButtonInTheAddressBar", e.target.value);
  };
  $("#showButtonInTheAddressBar").value = twpConfig.get(
    "showButtonInTheAddressBar"
  ); // 初始化

  $("#translateClickingOnce").onchange = (e) => { // 单击一次即翻译开关
    twpConfig.set("translateClickingOnce", e.target.value);
  };
  $("#translateClickingOnce").value = twpConfig.get("translateClickingOnce"); // 初始化

  // ── Provider Registry 初始化 ──
  migrateProviderConfig(twpConfig); // 运行一次性迁移

  // Populate the AI provider dropdown from the registry
  const providerRegistry = createProviderRegistry(BUILT_IN_PROVIDERS);
  // 优先使用当前仍在读写的 aiProvider；旧的 activeProviderId 仅作为兼容回退，避免历史值抢占用户新选择。
  const activeId = twpConfig.get("aiProvider") || twpConfig.get("activeProviderId") || "openai";

  const _aiProviderDropdown = document.querySelector("#aiProvider");
  if (_aiProviderDropdown) {
    const builtInProviders = providerRegistry.listProviders();

    /** 从 models.dev 数据构建 provider 定义 */
    function _buildDevProviderDefs(devData) {
      const defs = [];
      for (const [devId, devInfo] of Object.entries(devData)) {
        const npm = devInfo.npm || "@ai-sdk/openai-compatible";
        // 包含 ${VAR} 模板变量 → 视为无 api（用户必须手动输入）
        const rawApi = devInfo.api || "";
        const apiBase = (rawApi && !rawApi.includes("${")) ? rawApi : lookupKnownApiBase(devId);
        defs.push({
          id: devId,
          name: devInfo.name || devId,
          apiBase,
          modelListUrl: apiBase ? (apiBase.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "") + "/models") : null,
          auth: { type: npm.includes("anthropic") ? "api-key-header" : "bearer", header: "Authorization", prefix: "Bearer " },
          responseFormat: npm.includes("anthropic") ? "anthropic-sse" : "openai-sse",
          supportsStreaming: true,
          source: "models.dev",
          category: "dynamic",
          tags: [],
        });
      }
      return defs;
    }

    /** 提供商 ID → i18n 消息键映射 */
    const PROVIDER_I18N_MAP = {
      "openai": "aiProviderOpenAI",
      "anthropic": "aiProviderAnthropic",
      "google-gemini": "aiProviderGoogleGemini",
      "mistral": "aiProviderMistral",
      "cohere": "aiProviderCohere",
      "together": "aiProviderTogether",
      "groq": "aiProviderGroq",
      "openrouter": "aiProviderOpenRouter",
      "azure-openai": "aiProviderAzureOpenAI",
      "deepseek": "aiProviderDeepSeek",
      "zhipu": "aiProviderZhipu",
      "moonshot": "aiProviderMoonshot",
      "qwen": "aiProviderQwen",
      "baidu": "aiProviderBaidu",
      "bytedance": "aiProviderBytedance",
      "iflytek": "aiProviderIflytek",
      "perplexity": "aiProviderPerplexity",
      "grok": "aiProviderGrok",
      "deepinfra": "aiProviderDeepInfra",
      "cerebras": "aiProviderCerebras",
      "vercel": "aiProviderVercel",
    };

    /**
     * 获取提供商的本地化名称
     * @param {string} providerId 提供商 ID
     * @param {string} fallbackName 原始名称（回退）
     * @returns {string} 本地化名称
     */
    function _getProviderLocalizedName(providerId, fallbackName) {
      const i18nKey = PROVIDER_I18N_MAP[providerId];
      if (i18nKey) {
        const localized = chrome.i18n.getMessage(i18nKey);
        if (localized) return localized;
      }
      return fallbackName;
    }

    /** 渲染下拉列表 */
    function _renderProviderDropdown(providers) {
      /** @type {Array<Object>} */
      const normalizedProviders = Array.isArray(providers) ? providers : [];
      /** @type {Object<string, any>} */
      const providerConfigs = twpConfig.get("providerConfigs") || {};
      /** @type {Set<string>} */
      const existingIds = new Set(normalizedProviders.map((provider) => provider.id));
      /** @type {Array<Object>} */
      const mergedProviders = [...normalizedProviders];
      for (const [providerId, providerConfig] of Object.entries(providerConfigs)) {
        /** @type {boolean} */
        const isCustomProvider = String(providerId || "").startsWith("_custom_");
        /** @type {string} */
        const customProviderName = String(providerConfig?.name || "").trim();
        if (!isCustomProvider || existingIds.has(providerId) || !customProviderName) continue;
        mergedProviders.push({ id: providerId, name: customProviderName });
        existingIds.add(providerId);
      }
      _aiProviderDropdown.innerHTML = "";
      for (const p of mergedProviders) {
        const opt = document.createElement("option");
        opt.value = p.id;
        // 使用 i18n 本地化名称，如果没有对应翻译则使用原始名称
        opt.textContent = _getProviderLocalizedName(p.id, p.name);
        if (p.id === activeId) opt.selected = true;
        _aiProviderDropdown.appendChild(opt);
      }
    }

    /** 显示/隐藏 "加载中" */
    const _providerLoadingSpan = document.createElement("span");
    _providerLoadingSpan.className = "model-loading-msg";
    _providerLoadingSpan.setAttribute("data-i18n", "msgLoadingModels");
    _providerLoadingSpan.textContent = "加载中...";
    _providerLoadingSpan.style.display = "none";
    _aiProviderDropdown.parentNode?.insertBefore(_providerLoadingSpan, _aiProviderDropdown.nextSibling);

    function _showProviderLoading(show) {
      _providerLoadingSpan.style.display = show ? "" : "none";
    }

    /** 主加载逻辑 */
    async function _loadProviderDropdown() {
      // 尝试读 models.dev 缓存
      let devData = null;
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        try {
          const cache = await chrome.storage.local.get("modelsdev:providers");
          devData = cache?.["modelsdev:providers"]?.data;
        } catch (_) {}
      }

      const isValid = devData && typeof devData === "object" && Object.keys(devData).length > 10;

      if (isValid) {
        // ① 缓存正常 → 合并 models.dev 数据 + 缺失的 built-in 提供商
        const devDefs = _buildDevProviderDefs(devData);
        const devIds = new Set(devDefs.map((d) => d.id));
        for (const bp of builtInProviders) {
          if (!devIds.has(bp.id)) devDefs.push(bp);  // 补充 models.dev 中缺失的提供商
        }
        _renderProviderDropdown(devDefs);
      } else {
        // ② 缓存异常 → 显示内置供应商
        _renderProviderDropdown(builtInProviders);
        // 如果完全没有缓存，显示加载中并等待
        if (!devData && typeof chrome !== "undefined" && chrome.storage?.local) {
          _showProviderLoading(true);
        }
      }
      _showProviderLoading(false);
    }

    _loadProviderDropdown();

    // ③ 监听 storage 变更，数据到达后自动刷新下拉列表
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes) => {
        if (changes["modelsdev:providers"]) {
          _loadProviderDropdown();
        }
      });
    }

    // Wire generic panel: load config for the selected provider
    // Legacy config keys → providerConfigs fallback map
    const LEGACY_KEYS = {
      openai: { apiKey: "apiKeyOpenAI", model: "openAiModel" },
      openrouter: { apiKey: "apiKeyOpenRouter", model: "openRouterModel", apiBase: "openRouterApiBase" },
      anthropic: { apiKey: "apiKeyAnthropic", model: "anthropicModel" },
      "google-gemini": { apiKey: "apiKeyGoogleGemini", model: "googleGeminiModel" },
      "azure-openai": { apiKey: "apiKeyAzureOpenAI", model: "azureOpenAIModel", apiBase: "azureOpenAIEndpoint" },
      deepseek: { apiKey: "apiKeyDeepSeek", model: "deepSeekModel" },
      grok: { apiKey: "apiKeyGrok", model: "grokModel" },
    };

    // Highlight the three config inputs to guide the user
    function _highlightConfigInputs() {
      const inputs = [
        document.querySelector("#apiKeyGeneric"),
        document.querySelector("#genericApiBase"),
        document.querySelector("#genericModel"),
      ];
      inputs.forEach(el => {
        if (!el) return;
        el.classList.add("dualtran-input-highlight");
        setTimeout(() => el.classList.remove("dualtran-input-highlight"), 1500);
      });
    }

    function _loadGenericProviderConfig(providerId) {
      const providerConfigs = twpConfig.get("providerConfigs") || {};
      let stored = providerConfigs[providerId] || {};
      _highlightConfigInputs();

      // Legacy fallback: if no data in providerConfigs, try old config keys
      const legacy = LEGACY_KEYS[providerId];
      if (legacy && !stored.apiKey && !stored.model) {
        const apiKey = (twpConfig.get(legacy.apiKey) || "").trim();
        const model = (twpConfig.get(legacy.model) || "").trim();
        if (apiKey) stored.apiKey = apiKey;
        if (model) stored.model = model;
        if (legacy.apiBase) {
          const ab = (twpConfig.get(legacy.apiBase) || "").trim();
          if (ab) stored.apiBase = ab;
        }
      }
      const apiKeyInput = document.querySelector("#apiKeyGeneric");
      const apiBaseInput = document.querySelector("#genericApiBase");
      const modelSelect = document.querySelector("#genericModel");

      // 动态更新面板标签（优先 registry，fallback models.dev 缓存）
      let providerDef = providerRegistry.getProvider(providerId);
      function _updatePanelLabels(def) {
        const name = def?.name || providerId || "";
        const keyLabel = document.querySelector("#genericApiKeyLabel");
        const baseLabel = document.querySelector("#genericApiBaseLabel");
        const modelLabel = document.querySelector("#genericModelLabel");
        const apiKeyLink = document.querySelector("#genericApiKeyLink");
        if (keyLabel) keyLabel.textContent = name ? `${name} API Key` : "API Key";
        if (baseLabel) baseLabel.textContent = name ? `${name} API Endpoint URL` : "API Endpoint URL";
        if (modelLabel) modelLabel.textContent = name ? `${name} Model` : "Model";
        if (apiKeyLink) {
          if (def?.apiKeyUrl) {
            apiKeyLink.href = def.apiKeyUrl;
            apiKeyLink.textContent = `How to get ${name} API Key?`;
            apiKeyLink.style.display = "";
          } else if (def?.doc) {
            apiKeyLink.href = def.doc;
            apiKeyLink.textContent = `${name} Documentation`;
            apiKeyLink.style.display = "";
          } else {
            apiKeyLink.style.display = "none";
          }
        }
      }
      _updatePanelLabels(providerDef);
      // registry 中没有时，异步从 models.dev 补充标签
      if (!providerDef && typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.get("modelsdev:providers", (cacheRes) => {
          const devData = cacheRes?.["modelsdev:providers"]?.data?.[providerId];
          if (devData) {
            _updatePanelLabels({
              name: devData.name,
              apiBase: devData.api,
              apiKeyUrl: devData.apiKeyUrl || null,
              doc: devData.doc || null,
            });
          }
        });
      }
      if (apiKeyInput) apiKeyInput.value = stored.apiKey || "";
      if (apiBaseInput) {
        const providerDef = providerRegistry.getProvider(providerId);
        function _endpointPlaceholder(apiBase) {
          if (!apiBase) return "";
          return apiBase.includes("/chat/completions") ? apiBase : apiBase.replace(/\/+$/, "") + "/chat/completions";
        }
        apiBaseInput.value = stored.apiBase || "";
        apiBaseInput.placeholder = _endpointPlaceholder(providerDef?.apiBase || lookupKnownApiBase(providerId));
        // registry 中没有时，异步从 models.dev 缓存补充 placeholder
        if (!providerDef && typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.get("modelsdev:providers", (cacheRes) => {
            const devData = cacheRes?.["modelsdev:providers"]?.data?.[providerId];
            const rawApi = devData?.api || "";
            const api = (rawApi && !rawApi.includes("${")) ? rawApi : lookupKnownApiBase(providerId);
            if (api && apiBaseInput && !apiBaseInput.value) {
              apiBaseInput.placeholder = _endpointPlaceholder(api);
            }
          });
        }
      }
      // Populate model select
      if (modelSelect) {
        const providerDef = providerRegistry.getProvider(providerId);
        const customProviderName = (stored.name || providerId || "").trim();
        const customProviderRegistry = createProviderRegistry([
          {
            id: providerId,
            name: customProviderName || providerId,
            apiBase: stored.apiBase || "",
            modelListUrl: normalizeOpenAiCompatibleModelsEndpoint(stored.apiBase || ""),
            auth: { type: "bearer", header: "Authorization", prefix: "Bearer " },
            responseFormat: "openai-sse",
            modelListParser: { path: "data", valueKey: "id", labelKey: "id" },
          },
        ]);
        const canLoadCustomProviderModels = Boolean(
          !providerDef && stored.apiKey && normalizeOpenAiCompatibleModelsEndpoint(stored.apiBase || "")
        );
        const hasModelApi = providerDef?.modelListUrl || providerDef?.id === "google-gemini" || canLoadCustomProviderModels;
        const storedModel = stored.model || "";

        // Helper: hide the "加载中" span above the select
        function _hideLoading() {
          const labelP = modelSelect?.previousElementSibling;
          if (!labelP) return;
          const span = labelP.querySelector(".model-loading-msg");
          if (span) span.style.display = "none";
        }

        if (stored.apiKey && hasModelApi) {
          // Has API key and model list endpoint → fetch from API
          modelSelect.disabled = true;
          modelSelect.innerHTML = '<option value="" disabled>Loading...</option>';
          loadAiProviderModelOptions({
            provider: providerId,
            apiKey: stored.apiKey,
            endpoint: canLoadCustomProviderModels ? stored.apiBase : undefined,
            registry: canLoadCustomProviderModels ? customProviderRegistry : undefined,
            translate: i18nOrDefault,
          }).then(models => {
            modelSelect.innerHTML = "";
            for (const m of models) {
              const opt = document.createElement("option");
              opt.value = m.value;
              opt.textContent = m.text || m.value;
              modelSelect.appendChild(opt);
            }
            if (storedModel && !models.some(m => m.value === storedModel)) {
              const opt = document.createElement("option");
              opt.value = storedModel;
              opt.textContent = storedModel;
              modelSelect.appendChild(opt);
            }
            modelSelect.disabled = false;
            if (storedModel) modelSelect.value = storedModel;
            _hideLoading();
          }).catch(() => {
            // API Key 拉取失败 → 先加载预览模型，再在前面插入提示
            _loadPreviewModelsFallback(true);
          });
        } else {
          // No API key or no model list API → loadPreviewModels
          _loadPreviewModelsFallback(false);
        }

        function _loadPreviewModelsFallback(showErrorNotice) {
          if (!modelSelect) return;
          modelSelect.disabled = true;
          modelSelect.innerHTML = '<option value="" disabled>Loading...</option>';
          loadPreviewModels({ provider: providerId }).then(models => {
            modelSelect.innerHTML = "";
            // API Key 拉取失败时，在第一行插入提示
            if (showErrorNotice) {
              const notice = chrome.i18n.getMessage("msgModelListFetchFailed") || "Failed to fetch model list with API key. Available models:";
              const noticeOpt = document.createElement("option");
              noticeOpt.value = "";
              noticeOpt.textContent = notice;
              noticeOpt.disabled = true;
              modelSelect.appendChild(noticeOpt);
            }
            for (const m of models) {
              const opt = document.createElement("option");
              opt.value = m.value;
              opt.textContent = m.text || m.value;
              modelSelect.appendChild(opt);
            }
            if (storedModel && !models.some(m => m.value === storedModel)) {
              const opt = document.createElement("option");
              opt.value = storedModel;
              opt.textContent = storedModel;
              modelSelect.appendChild(opt);
            }
            // 加载用户之前添加的自定义模型
            const customModels = stored.customModels || [];
            for (const cm of customModels) {
              if (!models.some(m => m.value === cm)) {
                const opt = document.createElement("option");
                opt.value = cm;
                opt.textContent = cm;
                modelSelect.appendChild(opt);
              }
            }
            modelSelect.disabled = false;
            if (storedModel) modelSelect.value = storedModel;
            _hideLoading();
          }).catch(() => {
            modelSelect.innerHTML = '<option value="" disabled>Error loading models</option>';
            modelSelect.disabled = false;
            _hideLoading();
          });
        }
      }
    }

    function _saveGenericProviderConfig(providerId) {
      const providerConfigs = twpConfig.get("providerConfigs") || {};
      if (!providerConfigs[providerId]) providerConfigs[providerId] = {};
      const apiKeyInput = document.querySelector("#apiKeyGeneric");
      const apiBaseInput = document.querySelector("#genericApiBase");
      const modelSelect = document.querySelector("#genericModel");
      if (apiKeyInput) providerConfigs[providerId].apiKey = apiKeyInput.value.trim();
      if (apiBaseInput) providerConfigs[providerId].apiBase = apiBaseInput.value.trim();
      if (modelSelect) providerConfigs[providerId].model = modelSelect.value || "";
      twpConfig.set("providerConfigs", providerConfigs);
    }

    // Wire generic inputs — use "input" for real-time save (change fires only on blur)
    document.querySelector("#apiKeyGeneric")?.addEventListener("input", () => {
      const providerId = _aiProviderDropdown.value;
      _saveGenericProviderConfig(providerId);
    });
    document.querySelector("#apiKeyGeneric")?.addEventListener("change", () => {
      const providerId = _aiProviderDropdown.value;
      _loadGenericProviderConfig(providerId); // reload models on blur with new key
    });
    document.querySelector("#genericApiBase")?.addEventListener("change", () => {
      _saveGenericProviderConfig(_aiProviderDropdown.value);
    });
    document.querySelector("#genericModel")?.addEventListener("change", () => {
      _saveGenericProviderConfig(_aiProviderDropdown.value);
    });

    // 所有供应商统一走 generic 面板
    _aiProviderDropdown.addEventListener("change", () => {
      _loadGenericProviderConfig(_aiProviderDropdown.value);
    });

    // 初始化：等 dropdown 填充完毕后，读取实际选中的值加载配置
    _loadProviderDropdown().then(() => {
      _loadGenericProviderConfig(_aiProviderDropdown.value || activeId);
    });

    // ── "新建自定义提供商" 按钮 ──
    const _btnAddCustomProvider = document.querySelector("#btnAddCustomProvider");
    if (_btnAddCustomProvider) {
      _btnAddCustomProvider.addEventListener("click", () => {
        const name = (prompt("Enter provider name:") || "").trim();
        if (!name) return;
        const id = "_custom_" + name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const apiBase = (prompt("Enter API Endpoint URL (optional, press OK to skip):") || "").trim();

        // 添加到下拉列表
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = name;
        opt.selected = true;
        _aiProviderDropdown.appendChild(opt);
        _aiProviderDropdown.value = id;

        // 保存到 providerConfigs
        const providerConfigs = twpConfig.get("providerConfigs") || {};
        providerConfigs[id] = { name, apiBase, model: "", apiKey: "" };
        twpConfig.set("providerConfigs", providerConfigs);

        _loadGenericProviderConfig(id);
      });
    }

    // ── "新增自定义模型" 按钮 ──
    const _btnAddCustomModel = document.querySelector("#btnAddCustomModel");
    if (_btnAddCustomModel) {
      _btnAddCustomModel.addEventListener("click", () => {
        const modelName = (prompt("Enter model name/ID:") || "").trim();
        if (!modelName) return;
        const modelSelect = document.querySelector("#genericModel");
        if (!modelSelect) return;

        const opt = document.createElement("option");
        opt.value = modelName;
        opt.textContent = modelName;
        opt.selected = true;
        modelSelect.appendChild(opt);
        modelSelect.value = modelName;

        // 持久化
        const providerId = _aiProviderDropdown.value;
        const providerConfigs = twpConfig.get("providerConfigs") || {};
        if (!providerConfigs[providerId]) providerConfigs[providerId] = {};
        if (!providerConfigs[providerId].customModels) providerConfigs[providerId].customModels = [];
        if (!providerConfigs[providerId].customModels.includes(modelName)) {
          providerConfigs[providerId].customModels.push(modelName);
        }
        providerConfigs[providerId].model = modelName;
        twpConfig.set("providerConfigs", providerConfigs);
      });
    }
  }


  $("#btnCalculateStorage").style.display = "inline-block"; // 显示"计算存储"按钮
  $("#storageUsed").style.display = "none"; // 初始隐藏存储信息
  $("#btnCalculateStorage").onclick = (e) => { // 计算缓存使用大小按钮
    $("#btnCalculateStorage").style.display = "none"; // 隐藏按钮避免重复点击

    chrome.runtime.sendMessage( // 请求后台返回缓存大小
      {
        action: "getCacheSize",
      },
      (result) => { // 回调显示结果
        $("#storageUsed").textContent = result; // 显示数值
        $("#storageUsed").style.display = "inline-block"; // 展现
      }
    );
  };
});

window.scrollTo({ // 确保页面加载后滚动到顶部
  top: 0,
});
