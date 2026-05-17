// app.js – 主逻辑 (优化版)
// 优化内容：
// 1. 修复全局变量遮蔽（history -> requestHistory）
// 2. 修复 NaN 检查逻辑（使用 Number.isNaN）
// 3. 移除所有 innerHTML，改用安全的 DOM 创建方式
// 4. SSE 流式渲染增量更新，避免频繁 DOM 重建
// 5. 代码模块化拆分，提取公共函数
// 6. 增强错误处理和用户体验
// 7. 兼容性优化（降级处理）

;(function () {
  'use strict';

  const C = window.AppConfig;

  // ==================== 工具函数 ====================

  function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function debounce(fn, delay) {
    let timer = null;
    return function () {
      const args = arguments;
      const self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, delay);
    };
  }

  function safeDomOp(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      console.warn('DOM 操作失败：', e.message);
      return fallback !== undefined ? fallback : null;
    }
  }

  function generateIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
    return 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  // ==================== 常量与状态 ====================

  const REQUEST_TIMEOUT_MS = 60000;
  const MAX_RETRIES = 3;
  const RETRYABLE_STATUSES = [429, 502, 503, 504];

  function isCorsError(err) {
    if (err.name === 'TypeError' && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('Network request failed'))) return true;
    return false;
  }

  function getCorsErrorMessage(context) {
    return 'CORS 跨域错误：' + context + '被浏览器阻止。解决方案：\n' +
      '1. 安装浏览器扩展（推荐「CORS Unblock」或「Allow CORS」）\n' +
      '2. 通过后端代理服务器转发请求\n' +
      '3. 使用本地 CORS 代理（npx local-cors-proxy）';
  }

  let currentConfig = C.createDefaultConfig();
  let requestHistory = C.loadHistory();

  let _syncSource = null;

  let abortController = null;
  let requestStartTime = null;
  let streamingResponse = '';
  let currentResponseData = null;
  let currentResponseType = 'json';
  let currentRawResponseText = '';
  let fetchedModels = [];

  let uploadedFiles = [];
  let currentUploadType = 'image';
  let _lastFormRenderKey = '';

  var $ = function (id) { return document.getElementById(id); };

  // ==================== DOM 元素缓存 ====================

  const baseUrlInput = $('baseUrl');
  const endpointPathInput = $('endpointPath');
  const endpointPathSelect = $('endpointPathSelect');
  const httpMethodSelect = $('httpMethod');
  const finalUrlSpan = $('finalUrl');
  const headersContainer = $('headersContainer');
  const addHeaderBtn = $('addHeaderBtn');

  const formContainer = $('formContainer');
  const modelRowContainer = $('modelRowContainer');
  const addParamBtn = $('addParamBtn');
  const requestJson = $('requestJson');
  const formatJsonBtn = $('formatJsonBtn');
  const parseJsonBtn = $('parseJsonBtn');
  const jsonError = $('jsonError');

  const sendBtn = $('sendBtn');
  const abortBtn = $('abortBtn');
  const requestTimeSpan = $('requestTime');

  const responseContainer = $('responseContainer');
  const httpStatusSpan = $('httpStatus');
  const durationSpan = $('duration');

  const historyList = $('historyList');
  const clearHistoryBtn = $('clearHistoryBtn');
  const exportHistoryBtn = $('exportHistoryBtn');

  const configSelect = $('configSelect');
  const loadConfigBtn = $('loadConfigBtn');
  const deleteConfigBtn = $('deleteConfigBtn');
  const configNameInput = $('configNameInput');
  const saveConfigBtn = $('saveConfigBtn');
  const exportConfigBtn = $('exportConfigBtn');
  const importConfigBtn = $('importConfigBtn');
  const importConfigFile = $('importConfigFile');

  const fetchModelsBtn = $('fetchModelsBtn');
  const modelFetchStatus = $('modelFetchStatus');
  const modelDatalist = $('modelDatalist');
  const shareUrlBtn = $('shareUrlBtn');

  const sidebarItems = document.querySelectorAll('.sidebar-item');
  const panelOverlay = $('panelOverlay');
  const savedConfigsPanel = $('savedConfigsPanel');
  const historyPanel = $('historyPanel');
  const configExpandBtn = $('configExpandBtn');
  const configSubmenu = $('configSubmenu');
  const configSubmenuList = $('configSubmenuList');
  const quickConfigName = $('quickConfigName');
  const quickSaveConfigBtn = $('quickSaveConfigBtn');
  const sidebarCollapseBtn = $('sidebarCollapseBtn');
  const sidebarEl = document.querySelector('.sidebar');

  const fileInput = $('fileInput');
  const uploadDropzone = $('uploadDropzone');
  const uploadPreview = $('uploadPreview');
  const uploadHint = $('uploadHint');
  const clearFilesBtn = $('clearFilesBtn');
  const insertFilesBtn = $('insertFilesBtn');

  // ==================== 安全的 DOM 创建工具 ====================

  function createElement(tag, options) {
    options = options || {};
    const el = document.createElement(tag);
    if (options.className) el.className = options.className;
    if (options.id) el.id = options.id;
    if (options.text) el.textContent = options.text;
    if (options.html) el.innerHTML = options.html;
    if (options.attrs) {
      Object.keys(options.attrs).forEach(function (k) {
        el.setAttribute(k, options.attrs[k]);
      });
    }
    if (options.styles) {
      Object.keys(options.styles).forEach(function (k) {
        el.style[k] = options.styles[k];
      });
    }
    if (options.events) {
      Object.keys(options.events).forEach(function (k) {
        el.addEventListener(k, options.events[k]);
      });
    }
    return el;
  }

  function createDeleteIcon(size) {
    size = size || 16;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const paths = [
      'M3 6h18',
      'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
      'M10 11v6',
      'M14 11v6'
    ];
    paths.forEach(function (d) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', d.indexOf('M') === 0 ? 'path' : 'line');
      if (d.indexOf('M') === 0) {
        el.setAttribute('d', d);
      } else {
        const parts = d.split(' ');
        el.setAttribute('x1', parts[1]);
        el.setAttribute('y1', parts[2]);
        el.setAttribute('x2', parts[3]);
        el.setAttribute('y2', parts[4]);
      }
      svg.appendChild(el);
    });
    return svg;
  }

  function clearElement(el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  // ==================== Toast 和确认对话框 ====================

  function showToast(message, type) {
    type = type || 'info';
    const container = $('toastContainer');
    if (!container) return;
    const toast = createElement('div', {
      className: 'toast ' + type,
      text: message
    });
    container.appendChild(toast);
    requestAnimationFrame(function () {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(function () { toast.remove(); }, 300);
    }, C.TOAST_DISPLAY_MS);
  }

  function showConfirm(message, onConfirm) {
    const overlay = createElement('div', {
      className: 'confirm-overlay',
      attrs: {
        'role': 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'confirm-title'
      }
    });

    const dialog = createElement('div', { className: 'confirm-dialog' });
    const title = createElement('h3', {
      className: 'confirm-title',
      attrs: { id: 'confirm-title' },
      text: '确认操作'
    });
    const msg = createElement('p', { text: message });
    const actions = createElement('div', { className: 'confirm-actions' });
    const cancelBtn = createElement('button', {
      className: 'confirm-cancel',
      text: '取消',
      events: {
        click: function () { overlay.remove(); }
      }
    });
    const okBtn = createElement('button', {
      className: 'danger confirm-ok',
      text: '确认',
      events: {
        click: function () {
          overlay.remove();
          onConfirm();
        }
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    dialog.appendChild(title);
    dialog.appendChild(msg);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') overlay.remove();
    });
    okBtn.focus();
  }

  // ==================== 端点路径处理 ====================

  function isEndpointCustomMode() {
    const combo = document.querySelector('.endpoint-path-combo');
    return combo && combo.classList.contains('custom-mode');
  }

  function getEndpointPathValue() {
    return isEndpointCustomMode() ? endpointPathInput.value.trim() : endpointPathSelect.value.trim();
  }

  function setEndpointMode(isCustom, value) {
    const combo = document.querySelector('.endpoint-path-combo');
    if (!combo) return;
    if (isCustom) {
      combo.classList.add('custom-mode');
      endpointPathSelect.value = 'custom';
      endpointPathInput.value = value || '';
      endpointPathInput.focus();
    } else {
      combo.classList.remove('custom-mode');
      endpointPathSelect.value = value || 'custom';
    }
  }

  // ==================== 模型获取 ====================

  async function fetchModels() {
    const base = baseUrlInput.value.trim().replace(/\/+$/, '');
    if (!base) {
      modelFetchStatus.textContent = '';
      modelFetchStatus.className = 'fetch-status';
      return;
    }

    const url = C.buildNormalizedEndpointPath(base, 'models');

    const headers = {};
    currentConfig.headers.forEach(function (h) {
      if (!h.key) return;
      const sanitizedKey = h.key.replace(/[\r\n]/g, '');
      const sanitizedValue = String(h.value || '').replace(/[\r\n]/g, '');
      if (sanitizedKey) headers[sanitizedKey] = sanitizedValue;
    });

    const cacheKey = C.getCacheKey(url, 'GET', JSON.stringify(headers));
    const cached = C.getCachedResponse(cacheKey);
    if (cached) {
      fetchedModels = cached;
      clearElement(modelDatalist);
      cached.forEach(function (id) {
        const option = createElement('option', { attrs: { value: id } });
        modelDatalist.appendChild(option);
      });
      modelFetchStatus.textContent = '已从缓存加载 ' + cached.length + ' 个模型';
      modelFetchStatus.className = 'fetch-status success';
      return;
    }

    const pendingKey = 'fetchModels:' + cacheKey;
    const pending = C.getPendingRequest(pendingKey);
    if (pending) {
      modelFetchStatus.textContent = '模型列表请求进行中…';
      modelFetchStatus.className = 'fetch-status loading';
      try {
        const result = await pending;
        fetchedModels = result;
        clearElement(modelDatalist);
        result.forEach(function (id) {
          const option = createElement('option', { attrs: { value: id } });
          modelDatalist.appendChild(option);
        });
        modelFetchStatus.textContent = '已获取 ' + result.length + ' 个模型';
        modelFetchStatus.className = 'fetch-status success';
      } catch (e) {
        modelFetchStatus.textContent = '获取失败：' + e.message;
        modelFetchStatus.className = 'fetch-status error';
      }
      return;
    }

    modelFetchStatus.textContent = '正在获取模型列表…';
    modelFetchStatus.className = 'fetch-status loading';
    fetchModelsBtn.disabled = true;

    const fetchPromise = (async function () {
      const controller = new AbortController();
      const timeoutId = setTimeout(function () { controller.abort(); }, C.FETCH_MODELS_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        headers: headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' ' + response.statusText);
      }

      const data = await response.json();

      let models = [];
      if (Array.isArray(data.data)) {
        models = data.data.map(function (m) { return m.id || m.name || m.model; }).filter(Boolean);
      } else if (Array.isArray(data.models)) {
        models = data.models.map(function (m) { return typeof m === 'string' ? m : (m.id || m.name || m.model); }).filter(Boolean);
      } else if (Array.isArray(data)) {
        models = data.map(function (m) { return typeof m === 'string' ? m : (m.id || m.name || m.model); }).filter(Boolean);
      }

      models.sort(function (a, b) { return a.localeCompare(b); });
      return models;
    })();

    C.setPendingRequest(pendingKey, fetchPromise);

    try {
      const models = await fetchPromise;
      fetchedModels = models;
      C.setCachedResponse(cacheKey, models);

      clearElement(modelDatalist);
      models.forEach(function (id) {
        const option = createElement('option', { attrs: { value: id } });
        modelDatalist.appendChild(option);
      });

      modelFetchStatus.textContent = '已获取 ' + models.length + ' 个模型';
      modelFetchStatus.className = 'fetch-status success';
    } catch (err) {
      if (err.name === 'AbortError') {
        modelFetchStatus.textContent = '获取模型列表超时';
      } else if (isCorsError(err)) {
        modelFetchStatus.textContent = 'CORS 跨域错误：该端点不允许浏览器直接访问（/chat/completions 不受影响，是服务器端对不同端点的 CORS 配置差异）。解决方案：① 安装浏览器 CORS 扩展（如 CORS Unblock）；② 直接在模型输入框中手动输入模型 ID';
      } else {
        modelFetchStatus.textContent = '获取失败：' + err.message;
      }
      modelFetchStatus.className = 'fetch-status error';
    } finally {
      fetchModelsBtn.disabled = false;
      C.removePendingRequest(pendingKey);
    }
  }

  function checkPlaceholderApiKey() {
    const warnings = [];
    currentConfig.headers.forEach(function (h) {
      if (C.isSensitiveHeader(h.key) && C.isPlaceholderApiKey(h.value)) {
        warnings.push(h.key);
      }
    });
    return warnings;
  }

  /**
   * 将表单数据同步到 currentConfig
   * 从 DOM 表单元素中收集 messages、参数、自定义参数等数据，
   * 更新 currentConfig.body 和 currentConfig.customParams
   */
  function syncFormToConfig() {
    const roles = document.querySelectorAll('.msg-role');
    const contents = document.querySelectorAll('.msg-content');
    if (!currentConfig.body) currentConfig.body = {};
    currentConfig.body.messages = Array.from(roles).map(function (select, idx) {
      return {
        role: select.value,
        content: contents[idx] ? (contents[idx].value || '') : ''
      };
    });

    const currentParams = C.getEndpointParams(currentConfig.endpointPath);
    document.querySelectorAll('[data-param]').forEach(function (input) {
      const name = input.dataset.param;
      const param = currentParams.find(function (p) { return p.name === name; });
      if (!param) return;

      if (input.id && input.id.endsWith('-custom')) return;

      let value;
      if (param.type === 'checkbox') {
        value = input.checked;
      } else if (param.type === 'select') {
        const selectVal = input.value;
        if (selectVal === '__custom__') {
          const customInput = document.getElementById('param-' + name + '-custom');
          value = customInput ? customInput.value.trim() : '';
        } else if (selectVal === 'true') {
          value = true;
        } else if (selectVal === 'false') {
          value = false;
        } else {
          value = selectVal;
        }
      } else {
        value = input.value;
        if (param.type === 'number') {
          if (input.value.trim() !== '') {
            value = parseFloat(input.value);
            if (isNaN(value)) value = param.default != null ? param.default : 0;
            const validation = C.validateParamValue(name, value, param);
            if (!validation.valid) {
              showToast(validation.error, 'warning');
            }
          } else {
            delete currentConfig.body[name];
            return;
          }
        }
      }

      currentConfig.body[name] = value;
    });

    currentConfig.customParams = Array.from(document.querySelectorAll('.custom-key')).map(function (input, idx) {
      const key = input.value.trim();
      const valInputs = document.querySelectorAll('.custom-value');
      const valInput = valInputs[idx];
      let value = valInput ? valInput.value.trim() : '';
      if (!key) return null;

      try {
        value = JSON.parse(value);
      } catch (e) {
        // 保持字符串
      }
      return { key: key, value: value };
    }).filter(Boolean);
  }

  function fullConfigToJson(maskSensitive) {
    syncFormToConfig();
    const body = C.deepClone(currentConfig.body);

    currentConfig.customParams.forEach(function (p) {
      body[p.key] = p.value;
    });

    const headers = {};
    currentConfig.headers.forEach(function (h) {
      if (h.key) {
        const val = maskSensitive ? C.maskSensitiveValue(h.key, h.value) : C.sanitizeConfigValue(h.value);
        headers[h.key] = val;
      }
    });

    const fullConfig = {
      baseUrl: baseUrlInput.value.trim(),
      endpointPath: getEndpointPathValue(),
      httpMethod: httpMethodSelect.value,
      headers: headers,
      body: body
    };

    return JSON.stringify(fullConfig, null, 2);
  }

  function jsonToFullConfig(json) {
    const backupConfig = C.deepClone(currentConfig);
    const backupBaseUrl = baseUrlInput.value;
    const backupHttpMethod = httpMethodSelect.value;

    try {
      const fullConfig = JSON.parse(json);

      if (fullConfig.baseUrl !== undefined) {
        baseUrlInput.value = fullConfig.baseUrl;
        currentConfig.baseUrl = fullConfig.baseUrl;
      }
      if (fullConfig.endpointPath !== undefined) {
        currentConfig.endpointPath = C.normalizeEndpointPath(fullConfig.endpointPath);
      }
      if (fullConfig.httpMethod !== undefined) {
        httpMethodSelect.value = fullConfig.httpMethod;
        currentConfig.httpMethod = fullConfig.httpMethod;
      }

      if (fullConfig.headers && typeof fullConfig.headers === 'object') {
        currentConfig.headers = Object.entries(fullConfig.headers).map(function (entry) {
          return { key: C.sanitizeConfigValue(entry[0]), value: C.sanitizeConfigValue(String(entry[1])) };
        });
        renderHeaders();
      }

      if (fullConfig.body && typeof fullConfig.body === 'object') {
        currentConfig.body = fullConfig.body;
        currentConfig.customParams = [];
      } else if (fullConfig.body === undefined && fullConfig.model !== undefined) {
        const body = Object.assign({}, fullConfig);
        delete body.baseUrl;
        delete body.endpointPath;
        delete body.httpMethod;
        delete body.headers;
        currentConfig.body = body;
        currentConfig.customParams = [];
      }

      if (currentConfig.body && typeof currentConfig.body === 'object') {
        const extracted = C.extractPresetParamsFromBody(currentConfig.body, currentConfig.endpointPath, currentConfig.customParams);
        currentConfig.body = extracted.body;
        currentConfig.customParams = extracted.customParams;
      }

      renderEndpoint();
      renderFormMode();
      updateFinalUrl();
      jsonError.textContent = '';

      const validation = C.validateConfig({
        baseUrl: currentConfig.baseUrl,
        headers: currentConfig.headers,
        body: currentConfig.body
      });
      if (validation.warnings.length > 0) {
        validation.warnings.forEach(function (w) {
          showToast(w, 'warning');
        });
      }

      return true;
    } catch (e) {
      currentConfig = backupConfig;
      baseUrlInput.value = backupBaseUrl;
      httpMethodSelect.value = backupHttpMethod;
      jsonError.textContent = 'JSON 解析错误：' + e.message + '，请检查括号、引号是否匹配';
      return false;
    }
  }

  const debouncedUpdateJsonPreview = debounce(updateJsonPreview, C.JSON_PREVIEW_DELAY_MS);

  function updateJsonPreview() {
    if (_syncSource === 'json') return;
    _syncSource = 'form';
    try {
      requestJson.value = fullConfigToJson(true);
    } finally {
      _syncSource = null;
    }
  }

  function syncJsonToForm() {
    if (_syncSource === 'form') return;
    _syncSource = 'json';
    try {
      const json = requestJson.value;
      const jsonSize = new Blob([json]).size;
      if (jsonSize > 1024 * 1024) {
        jsonError.textContent = 'JSON 体积过大（' + (jsonSize / 1024 / 1024).toFixed(1) + 'MB），可能导致浏览器卡顿，建议减少数据量';
        return;
      }
      if (jsonToFullConfig(json)) {
        jsonError.textContent = '';
      }
    } finally {
      _syncSource = null;
    }
  }

  const debouncedSyncJsonToForm = debounce(syncJsonToForm, C.JSON_SYNC_DELAY_MS);

  // ==================== 渲染函数 ====================

  function renderEndpoint() {
    baseUrlInput.value = currentConfig.baseUrl;
    httpMethodSelect.value = currentConfig.httpMethod;

    const presetOptions = Array.from(endpointPathSelect.options).map(function (o) { return o.value; });
    if (presetOptions.includes(currentConfig.endpointPath) && currentConfig.endpointPath !== 'custom') {
      setEndpointMode(false, currentConfig.endpointPath);
      endpointPathInput.value = currentConfig.endpointPath;
    } else {
      setEndpointMode(true, currentConfig.endpointPath);
    }
  }

  function updateFinalUrl() {
    const base = baseUrlInput.value.trim().replace(/\/+$/, '');
    const rawPath = getEndpointPathValue();
    const url = C.buildNormalizedEndpointPath(base, rawPath);
    finalUrlSpan.textContent = url;
  }

  function renderHeaders() {
    clearElement(headersContainer);
    const tmpl = document.getElementById('tmplHeaderRow');
    currentConfig.headers.forEach(function (h, idx) {
      const clone = tmpl.content.cloneNode(true);
      const keyInput = clone.querySelector('.header-key');
      const valueInput = clone.querySelector('.header-value');
      const delBtn = clone.querySelector('.danger');
      keyInput.value = h.key || '';
      keyInput.dataset.idx = idx;
      valueInput.value = h.value || '';
      valueInput.dataset.idx = idx;
      delBtn.dataset.idx = idx;
      headersContainer.appendChild(clone);
    });
  }

  function buildPresetOptionsHtml() {
    const fragment = document.createDocumentFragment();
    const defaultOption = createElement('option', { attrs: { value: '' }, text: '-- 添加常用自定义参数 --' });
    fragment.appendChild(defaultOption);
    C.CUSTOM_PARAM_PRESETS.forEach(function (preset, idx) {
      const option = createElement('option', {
        attrs: { value: idx },
        text: preset.key + ' - ' + preset.description
      });
      fragment.appendChild(option);
    });
    return fragment;
  }

  /**
   * 根据当前配置渲染表单模式
   * 根据端点类型动态生成表单字段，包括预设参数、messages 编辑器（chat 端点）、
   * 自定义参数部分，并使用安全 DOM 创建方式
   */
  function computeFormRenderKey() {
    const parts = [currentConfig.endpointPath];
    const params = C.getEndpointParams(currentConfig.endpointPath);
    params.forEach(function (p) {
      parts.push(p.name);
      parts.push(currentConfig.body && currentConfig.body[p.name]);
    });
    const messages = (currentConfig.body && currentConfig.body.messages) || [];
    parts.push('msg:' + messages.length);
    messages.forEach(function (m) {
      parts.push(m.role);
      parts.push(typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length);
    });
    (currentConfig.customParams || []).forEach(function (p) {
      parts.push(p.key + '=' + p.value);
    });
    return parts.join('|');
  }

  function renderFormMode(forceRebuild) {
    if (!forceRebuild) {
      const newKey = computeFormRenderKey();
      if (newKey === _lastFormRenderKey) return;
      _lastFormRenderKey = newKey;
    }
    clearElement(formContainer);
    clearElement(modelRowContainer);

    const endpointPath = currentConfig.endpointPath;
    const hasMessages = C.endpointHasMessages(endpointPath);
    const params = C.getEndpointParams(endpointPath);

    const tip = createElement('div', {
      className: 'form-tip'
    });
    if (C.normalizeEndpointPath(endpointPath) === 'responses') {
      tip.appendChild(document.createTextNode('Responses API 使用 input 字段代替 messages。如需编辑复杂 input 数组或工具调用，建议切换到 '));
      const strong = createElement('strong', { text: 'JSON 模式' });
      tip.appendChild(strong);
      tip.appendChild(document.createTextNode('。'));
    } else if (C.normalizeEndpointPath(endpointPath) === 'chat/completions') {
      tip.textContent = '当前表单以 Chat Completions messages 格式为主。';
    } else {
      tip.textContent = '当前端点：' + endpointPath + '，参数已根据端点类型自动调整。';
    }
    formContainer.appendChild(tip);

    if (params.length > 0) {
      const paramsDiv = createElement('div', { className: 'params-section' });
      params.forEach(function (p) {
        const value = currentConfig.body && currentConfig.body[p.name];
        const row = createElement('div', { className: 'param-row' });

        let textDesc = createElement('span', {
          className: 'param-desc',
          attrs: { title: p.description || '' },
          text: p.description || ''
        });

        if (p.type === 'checkbox') {
          const checkboxLabel = createElement('label', {
            attrs: { for: 'param-' + p.name },
            text: p.name
          });
          const checkbox = createElement('input', {
            attrs: {
              id: 'param-' + p.name,
              type: 'checkbox',
              'data-param': p.name
            }
          });
          if (value) checkbox.checked = true;
          const desc = createElement('span', {
            className: 'param-desc',
            attrs: { title: p.description || '' },
            text: p.description || ''
          });
          row.appendChild(checkboxLabel);
          row.appendChild(checkbox);
          row.appendChild(desc);
        } else if (p.type === 'select') {
          const selectLabel = createElement('label', {
            attrs: { for: 'param-' + p.name },
            text: p.name
          });
          const isBoolSelect = (p.options || []).every(function (opt) { return typeof opt === 'boolean'; });
          const select = createElement('select', {
            attrs: {
              id: 'param-' + p.name,
              'data-param': p.name,
              autocomplete: 'off'
            }
          });
          if (!isBoolSelect) {
            const emptyOption = createElement('option', {
              attrs: { value: '' },
              text: '-- ' + (p.placeholder || '请选择') + ' --'
            });
            select.appendChild(emptyOption);
          }
          (p.options || []).forEach(function (opt) {
            const selected = value === opt ? ' selected' : '';
            const displayText = isBoolSelect ? (opt ? '是' : '否') : String(opt);
            const option = createElement('option', {
              attrs: { value: String(opt) },
              text: displayText
            });
            if (selected) option.selected = true;
            select.appendChild(option);
          });
          if (!isBoolSelect) {
            const customOption = createElement('option', {
              attrs: { value: '__custom__' },
              text: '自定义...'
            });
            select.appendChild(customOption);
          }
          let val = value != null ? value : p.default;
          val = val != null ? val : '';
          const isCustom = !isBoolSelect && val !== '' && !(p.options || []).includes(val);
          if (isCustom) {
            select.value = '__custom__';
          }
          const customInput = createElement('input', {
            attrs: {
              type: 'text',
              id: 'param-' + p.name + '-custom',
              'data-param': p.name,
              placeholder: '输入自定义值...',
              autocomplete: 'off',
              spellcheck: 'false'
            },
            styles: {
              display: isCustom ? '' : 'none',
              marginTop: 'var(--space-1)'
            }
          });
          if (isCustom) customInput.value = String(val);
          const selectDesc = createElement('span', {
            className: 'param-desc',
            attrs: { title: p.description || '' },
            text: p.description || ''
          });
          const selectWrapper = createElement('div', {
            styles: { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: '0' }
          });
          selectWrapper.appendChild(select);
          selectWrapper.appendChild(customInput);
          row.appendChild(selectLabel);
          row.appendChild(selectWrapper);
          row.appendChild(selectDesc);
        } else {
          const textLabel = createElement('label', {
            attrs: { for: 'param-' + p.name },
            text: p.name
          });
          const inputType = p.type === 'number' ? 'number' : 'text';
          let val = value != null ? value : p.default;
          val = val != null ? val : '';
          const inputAttrs = {
            id: 'param-' + p.name,
            type: inputType,
            'data-param': p.name,
            value: String(val),
            placeholder: (p.placeholder || '') + '…',
            autocomplete: 'off',
            spellcheck: 'false'
          };
          if (p.min != null) inputAttrs.min = p.min;
          if (p.max != null) inputAttrs.max = p.max;
          if (p.step != null) inputAttrs.step = p.step;
          if (p.name === 'model') {
            const modelDropdownWrap = createElement('div', { className: 'model-input-dropdown' });
            modelDropdownWrap.setAttribute('data-model-dropdown', 'true');
            const modelInput = createElement('input', { attrs: inputAttrs });
            modelInput.removeAttribute('list');
            const modelMenu = createElement('div', { className: 'model-input-dropdown-menu' });
            const modelSearchWrap = createElement('div', { className: 'model-input-dropdown-search' });
            const modelSearchInput = createElement('input', {
              attrs: { type: 'text', placeholder: '搜索模型…', autocomplete: 'off', spellcheck: 'false' }
            });
            modelSearchWrap.appendChild(modelSearchInput);
            const modelOptionsWrap = createElement('div', { className: 'model-input-dropdown-options' });
            if (fetchedModels.length > 0) {
              fetchedModels.forEach(function (m) {
                const optEl = createElement('div', {
                  className: 'model-input-dropdown-option' + (m === String(val) ? ' selected' : ''),
                  attrs: { 'data-value': m },
                  text: m
                });
                optEl.addEventListener('mousedown', function (e) {
                  e.preventDefault();
                  modelInput.value = m;
                  closeModelMenu();
                  modelInput.dispatchEvent(new Event('input', { bubbles: true }));
                });
                modelOptionsWrap.appendChild(optEl);
              });
            } else {
              const emptyEl = createElement('div', { className: 'model-input-dropdown-empty', text: '点击「获取模型」加载列表' });
              modelOptionsWrap.appendChild(emptyEl);
            }
            modelMenu.appendChild(modelSearchWrap);
            modelMenu.appendChild(modelOptionsWrap);
            modelSearchWrap.style.display = fetchedModels.length > C.DROPDOWN_SEARCH_THRESHOLD ? '' : 'none';
            function closeModelMenu() {
              modelMenu.classList.remove('open');
              modelSearchInput.value = '';
              filterModelOptions('');
            }
            function filterModelOptions(filterVal) {
              const lowerFilter = filterVal.toLowerCase();
              const opts = modelOptionsWrap.querySelectorAll('.model-input-dropdown-option');
              let visibleCount = 0;
              opts.forEach(function (o) {
                const match = !lowerFilter || o.textContent.toLowerCase().indexOf(lowerFilter) >= 0;
                o.style.display = match ? '' : 'none';
                if (match) visibleCount++;
              });
              const emptyEl = modelOptionsWrap.querySelector('.model-input-dropdown-empty');
              if (emptyEl) {
                emptyEl.style.display = visibleCount === 0 ? '' : 'none';
                if (visibleCount === 0 && lowerFilter) emptyEl.textContent = '无匹配模型';
              }
            }
            modelSearchInput.addEventListener('input', function () {
              filterModelOptions(modelSearchInput.value);
            });
            modelSearchInput.addEventListener('keydown', function (e) {
              if (e.key === 'Escape') { closeModelMenu(); modelInput.focus(); }
            });
            modelInput.addEventListener('focus', function () {
              modelMenu.classList.add('open');
              if (modelSearchWrap.style.display !== 'none') {
                setTimeout(function () { modelSearchInput.focus(); }, 0);
              }
            });
            modelInput.addEventListener('blur', function () {
              setTimeout(closeModelMenu, 150);
            });
            modelInput.addEventListener('input', function () {
              if (!modelMenu.classList.contains('open')) modelMenu.classList.add('open');
              filterModelOptions(modelInput.value);
            });
            modelDropdownWrap.appendChild(modelInput);
            modelDropdownWrap.appendChild(modelMenu);
            row.appendChild(textLabel);
            row.appendChild(modelDropdownWrap);
            row.appendChild(textDesc);
          } else {
            if (p.datalist) inputAttrs.list = p.datalist;
            const textInput = createElement('input', { attrs: inputAttrs });
            row.appendChild(textLabel);
            row.appendChild(textInput);
            row.appendChild(textDesc);
          }
        }
        if (p.name === 'model') {
          modelRowContainer.appendChild(row);
        } else {
          paramsDiv.appendChild(row);
        }
      });
      if (paramsDiv.firstChild) formContainer.appendChild(paramsDiv);
    }

    if (hasMessages) {
      const messages = (currentConfig.body && currentConfig.body.messages) || [];
      const msgDiv = createElement('div', { className: 'msg-section' });
      const msgTitle = createElement('h3', { text: 'messages' });
      msgDiv.appendChild(msgTitle);
      const msgTmpl = document.getElementById('tmplMsgRow');
      messages.forEach(function (m, idx) {
        const clone = msgTmpl.content.cloneNode(true);
        const roleSelect = clone.querySelector('.msg-role');
        roleSelect.id = 'msg-role-' + idx;
        roleSelect.dataset.msgIdx = idx;
        roleSelect.value = m.role || 'user';
        const labels = clone.querySelectorAll('label');
        if (labels.length >= 2) {
          labels[0].setAttribute('for', 'msg-role-' + idx);
          labels[1].setAttribute('for', 'msg-content-' + idx);
        }
        const contentTextarea = clone.querySelector('.msg-content');
        contentTextarea.id = 'msg-content-' + idx;
        contentTextarea.dataset.msgIdx = idx;
        contentTextarea.value = m.content || '';
        const delBtn = clone.querySelector('.danger');
        delBtn.dataset.msgIdx = idx;
        msgDiv.appendChild(clone);
      });

      const addMsgBtn = createElement('button', {
        className: 'secondary',
        attrs: { type: 'button' },
        styles: { marginTop: 'var(--space-3)' },
        text: '+ 添加消息',
        events: {
          click: function () {
            currentConfig.body.messages.push({ role: 'user', content: '' });
            renderFormMode();
            updateJsonPreview();
          }
        }
      });
      msgDiv.appendChild(addMsgBtn);
      formContainer.appendChild(msgDiv);
    }

    const customDiv = createElement('div', { className: 'custom-params-section' });
    const customTitle = createElement('h3', { text: '自定义参数' });
    customDiv.appendChild(customTitle);

    const presetSelect = createElement('select', {
      attrs: { id: 'customParamPreset' }
    });
    presetSelect.appendChild(buildPresetOptionsHtml());
    presetSelect.addEventListener('change', function (e) {
      const idx = parseInt(e.target.value);
      if (isNaN(idx)) return;
      const preset = C.CUSTOM_PARAM_PRESETS[idx];
      const exists = currentConfig.customParams.some(function (p) { return p.key === preset.key; });
      if (exists) {
        showToast('参数 ' + preset.key + ' 已存在', 'error');
        presetSelect.value = '';
        return;
      }
      currentConfig.customParams.push({ key: preset.key, value: preset.value });
      renderFormMode();
      updateJsonPreview();
      presetSelect.value = '';
    });
    const presetRow = createElement('div', { className: 'param-row preset-row' });
    const presetLabel = createElement('label', { text: '添加预设' });
    const presetPlaceholder = createElement('span');
    presetRow.appendChild(presetLabel);
    presetRow.appendChild(presetSelect);
    presetRow.appendChild(presetPlaceholder);
    customDiv.appendChild(presetRow);

    currentConfig.customParams.forEach(function (p, idx) {
      const row = createElement('div', { className: 'param-row custom-param-row' });
      const preset = C.CUSTOM_PARAM_PRESETS.find(function (cp) { return cp.key === p.key; });
      const desc = preset ? preset.description : '';
      const keyInput = createElement('input', {
        attrs: {
          type: 'text',
          value: p.key,
          'data-custom-idx': idx,
          class: 'custom-key',
          placeholder: '参数名…',
          'aria-label': '自定义参数名',
          spellcheck: 'false',
          autocomplete: 'off',
          title: desc
        }
      });
      const valInput = createElement('input', {
        attrs: {
          type: 'text',
          value: String(p.value),
          'data-custom-idx': idx,
          class: 'custom-value',
          placeholder: '参数值（JSON 字符串或普通文本）…',
          'aria-label': '自定义参数值',
          spellcheck: 'false',
          autocomplete: 'off',
          title: desc
        }
      });
      const delBtn = createElement('button', {
        attrs: {
          type: 'button',
          class: 'icon-btn danger',
          'data-custom-idx': idx,
          'aria-label': '删除自定义参数',
          title: '删除'
        }
      });
      delBtn.appendChild(createDeleteIcon(16));
      row.appendChild(keyInput);
      row.appendChild(valInput);
      row.appendChild(delBtn);
      customDiv.appendChild(row);
    });
    formContainer.appendChild(customDiv);
  }

  function renderHistory() {
    clearElement(historyList);
    if (requestHistory.length === 0) {
      const empty = createElement('li', {
        className: 'empty-state',
        text: '暂无历史记录，发送请求后会自动保存',
        styles: { cursor: 'default' }
      });
      historyList.appendChild(empty);
      return;
    }
    const dtFormat = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const tmpl = document.getElementById('tmplHistoryItem');
    requestHistory.forEach(function (item) {
      const clone = tmpl.content.cloneNode(true);
      const li = clone.querySelector('li');
      li.dataset.id = item.id;
      li.setAttribute('aria-label', item.method + ' ' + item.httpStatus + ' ' + item.url);
      li.querySelector('.history-time').textContent = dtFormat.format(new Date(item.timestamp));
      li.querySelector('.history-status').textContent = item.method + ' ' + item.httpStatus + ' ' + item.duration + 'ms';
      li.querySelector('.history-url').textContent = item.url;
      historyList.appendChild(clone);
    });
  }

  function renderConfigSelect() {
    const configs = C.loadSavedConfigs();
    clearElement(configSelect);
    const defaultOption = createElement('option', {
      attrs: { value: '' },
      text: '-- 选择已保存的配置 --'
    });
    configSelect.appendChild(defaultOption);
    configs.forEach(function (cfg) {
      const option = createElement('option', {
        attrs: { value: cfg.name },
        text: cfg.name
      });
      configSelect.appendChild(option);
    });
  }

  // ==================== 响应渲染（性能优化版） ====================

  let _streamPreElement = null;

  let _streamLastLength = 0;
  let _streamRafId = null;
  let _streamPendingText = '';

  function renderStreamingText(text) {
    if (!_streamPreElement) {
      clearElement(responseContainer);
      _streamPreElement = createElement('pre', {
        className: 'response-pre'
      });
      responseContainer.appendChild(_streamPreElement);
      _streamLastLength = 0;
    }

    _streamPendingText = text;
    if (!_streamRafId) {
      _streamRafId = requestAnimationFrame(function () {
        _streamRafId = null;
        if (!_streamPreElement) return;
        const pending = _streamPendingText;
        if (pending.length > _streamLastLength) {
          const newText = pending.substring(_streamLastLength);
          _streamPreElement.appendChild(document.createTextNode(newText));
          _streamLastLength = pending.length;
          responseContainer.scrollTop = responseContainer.scrollHeight;
        }
      });
    }
  }

  function resetStreamElement() {
    _streamPreElement = null;
    _streamLastLength = 0;
    _streamPendingText = '';
    if (_streamRafId) {
      cancelAnimationFrame(_streamRafId);
      _streamRafId = null;
    }
  }

  function renderResponse(data) {
    resetStreamElement();
    clearElement(responseContainer);

    var chatContent = extractChatContent(data);
    if (chatContent) {
      const contentEl = createElement('div', { className: 'stream-content' });
      contentEl.appendChild(formatChatContent(chatContent));
      responseContainer.appendChild(contentEl);
      return;
    }

    if (renderImageResponse(data)) return;
    if (renderAudioResponse(data)) return;

    const json = JSON.stringify(data, null, 2);
    const pre = createElement('pre', {
      className: 'response-pre',
      text: json
    });
    responseContainer.appendChild(pre);
  }

  function extractChatContent(data) {
    if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0) return null;
    var choice = data.choices[0];
    if (!choice.message) return null;
    var msg = choice.message;
    var reasoning = msg.reasoning_content || '';
    var content = msg.content || '';
    if (!reasoning && !content) return null;
    if (reasoning) {
      return '[思考] ' + reasoning + '\n\n' + content;
    }
    return content;
  }

  function renderImageResponse(data) {
    if (!data || !data.data || !Array.isArray(data.data) || data.data.length === 0) return false;
    var hasImage = data.data.some(function (item) {
      return item.url || item.b64_json;
    });
    if (!hasImage) return false;

    var resolvedKey = C.resolveApiKeyFromSources(['store', 'header'], currentConfig.headers);
    var authKey = resolvedKey && resolvedKey.key ? resolvedKey.key : null;

    data.data.forEach(function (item, idx) {
      var wrapper = createElement('div', { className: 'generated-image-wrapper' });

      if (item.url) {
        var loadingEl = createElement('div', { className: 'image-loading', text: '正在加载图片…' });
        wrapper.appendChild(loadingEl);

        var img = document.createElement('img');
        img.alt = 'API 生成图片';
        img.style.display = 'none';
        img.addEventListener('click', function () { openImageLightbox(img.src); });
        wrapper.appendChild(img);

        var link = createElement('a', {
          className: 'download-link',
          attrs: { href: item.url, target: '_blank', rel: 'noopener noreferrer' },
          text: '在新标签页中打开图片'
        });
        link.style.display = 'none';
        wrapper.appendChild(link);

        var fetchHeaders = {};
        if (authKey) {
          fetchHeaders['Authorization'] = 'Bearer ' + authKey;
        }

        fetch(item.url, { headers: fetchHeaders, mode: 'cors' })
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.blob();
          })
          .then(function (blob) {
            var blobUrl = URL.createObjectURL(blob);
            img.src = blobUrl;
            img.style.display = '';
            loadingEl.style.display = 'none';
            link.style.display = '';
            link.href = blobUrl;
            link.textContent = '查看原图';
          })
          .catch(function () {
            img.src = item.url;
            img.style.display = '';
            loadingEl.style.display = 'none';
            link.style.display = '';
            img.addEventListener('error', function () {
              img.style.display = 'none';
              link.href = item.url;
              link.textContent = '在新标签页中打开图片';
            });
          });
      } else if (item.b64_json) {
        var ext = item.mime_type && item.mime_type.includes('png') ? 'png' : 'jpeg';
        var img = document.createElement('img');
        img.alt = 'API 生成图片';
        img.src = 'data:image/' + ext + ';base64,' + item.b64_json;
        img.addEventListener('click', function () { openImageLightbox(img.src); });
        wrapper.appendChild(img);
      }

      if (item.revised_prompt) {
        var p = createElement('p', {
          className: 'param-desc',
          text: item.revised_prompt
        });
        wrapper.appendChild(p);
      }

      if (item.size) {
        var sizeInfo = createElement('span', {
          className: 'chat-msg-meta',
          text: '尺寸: ' + item.size
        });
        wrapper.appendChild(sizeInfo);
      }

      responseContainer.appendChild(wrapper);
    });

    if (data.usage) {
      var metaDiv = createElement('div', {
        className: 'chat-msg-meta',
        text: '生成图片: ' + (data.usage.generated_images || data.data.length) + ' · Tokens: ' + (data.usage.total_tokens || '?')
      });
      responseContainer.appendChild(metaDiv);
    }

    return true;
  }

  function renderAudioResponse(data) {
    if (!data || !Array.isArray(data.data) || data.data.length === 0) return false;
    var hasAudio = data.data.some(function (item) {
      return item.audio;
    });
    if (!hasAudio) return false;

    data.data.forEach(function (item) {
      if (item.audio) {
        var audioData = item.audio;
        if (audioData.data || audioData.id) {
          var src = audioData.data
            ? 'data:audio/mp3;base64,' + audioData.data
            : '';
          if (src) {
            var audio = createElement('audio', {
              attrs: { controls: true, src: src }
            });
            responseContainer.appendChild(audio);
          }
        }
      }
    });

    return true;
  }

  var _lightboxEscHandler = null;

  function openImageLightbox(src) {
    var existing = document.querySelector('.image-lightbox');
    if (existing) closeImageLightbox();

    var overlay = document.createElement('div');
    overlay.className = 'image-lightbox';

    var img = document.createElement('img');
    img.src = src;
    img.alt = '放大预览';
    img.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    var closeBtn = document.createElement('button');
    closeBtn.className = 'image-lightbox-close';
    closeBtn.innerHTML = '&#10005;';
    closeBtn.setAttribute('aria-label', '关闭大图');
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeImageLightbox();
    });

    overlay.appendChild(img);
    overlay.appendChild(closeBtn);

    overlay.addEventListener('click', function () {
      closeImageLightbox();
    });

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    _lightboxEscHandler = function (e) {
      if (e.key === 'Escape') closeImageLightbox();
    };
    document.addEventListener('keydown', _lightboxEscHandler);
  }

  function closeImageLightbox() {
    var overlay = document.querySelector('.image-lightbox');
    if (overlay) overlay.remove();
    document.body.style.overflow = '';
    if (_lightboxEscHandler) {
      document.removeEventListener('keydown', _lightboxEscHandler);
      _lightboxEscHandler = null;
    }
  }

  function renderTextResponse(text, contentType) {
    resetStreamElement();
    clearElement(responseContainer);
    const pre = createElement('pre', {
      className: 'response-pre',
      text: text
    });
    responseContainer.appendChild(pre);
  }

  function renderBlobResponse(blob, contentType) {
    resetStreamElement();
    clearElement(responseContainer);
    const url = URL.createObjectURL(blob);

    if (contentType.startsWith('image/')) {
      const img = createElement('img', {
        attrs: { src: url, alt: 'API 响应图片' }
      });
      responseContainer.appendChild(img);
    } else if (contentType.startsWith('audio/')) {
      const audio = createElement('audio', {
        attrs: { controls: true, src: url }
      });
      responseContainer.appendChild(audio);
    } else if (contentType.startsWith('video/')) {
      const video = createElement('video', {
        attrs: { controls: true, src: url }
      });
      responseContainer.appendChild(video);
    } else {
      const a = createElement('a', {
        className: 'download-link',
        attrs: { href: url, download: 'response' },
        text: '下载响应文件'
      });
      responseContainer.appendChild(a);
    }
  }

  // ==================== 历史记录管理 ====================

  function addHistory(params, httpStatus, duration) {
    const item = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      method: params.method,
      url: params.url,
      httpStatus: httpStatus,
      duration: duration,
      headers: sanitizeHeadersForStorage(params.headers),
      body: params.body
    };
    requestHistory.unshift(item);
    if (requestHistory.length > C.MAX_HISTORY_ITEMS) requestHistory = requestHistory.slice(0, C.MAX_HISTORY_ITEMS);
    C.saveHistory(requestHistory);
    renderHistory();
  }

  function loadHistoryToConfig(id) {
    const item = requestHistory.find(function (h) { return h.id === id; });
    if (!item) return;

    let baseUrl, endpointPath;
    try {
      const url = new URL(item.url);
      const knownEndpoints = Object.keys(C.ENDPOINT_TEMPLATES);
      const matchedEndpoint = knownEndpoints.find(function (ep) { return url.pathname.endsWith(ep); });
      if (matchedEndpoint) {
        endpointPath = matchedEndpoint;
        baseUrl = item.url.substring(0, item.url.lastIndexOf(matchedEndpoint));
      } else {
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2) {
          endpointPath = pathParts.slice(-2).join('/');
          baseUrl = url.origin + '/' + pathParts.slice(0, -2).join('/');
          if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        } else {
          endpointPath = url.pathname.replace(/^\//, '') || '';
          baseUrl = url.origin;
        }
      }
    } catch (e) {
      baseUrl = item.url;
      endpointPath = '';
    }

    baseUrlInput.value = baseUrl;
    currentConfig.endpointPath = endpointPath;
    httpMethodSelect.value = item.method;

    currentConfig.headers = Object.entries(item.headers).map(function (entry) {
      return { key: entry[0], value: entry[1] };
    });
    renderHeaders();

    try {
      const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
      currentConfig.body = body;
      currentConfig.customParams = [];

      const extracted = C.extractPresetParamsFromBody(currentConfig.body, endpointPath, currentConfig.customParams);
      currentConfig.body = extracted.body;
      currentConfig.customParams = extracted.customParams;

      renderFormMode();
      updateJsonPreview();
    } catch (e) {
      showToast('历史配置加载失败：' + e.message + '，请尝试手动填写参数', 'error');
    }

    renderEndpoint();
    updateFinalUrl();
    fetchModels();
  }

  // ==================== URL 参数与分享 ====================

  function restoreFromUrlParams() {
    const params = new URLSearchParams(location.search);
    let rawConfig = params.get('config');
    if (!rawConfig) return;

    if (rawConfig.startsWith('e:')) {
      try {
        rawConfig = C.deobfuscateValue(rawConfig);
      } catch (e) {
        showToast('分享链接解密失败，可能已过期或来源不同', 'warning');
        return;
      }
    }

    try {
      const decoded = JSON.parse(decodeURIComponent(rawConfig));
      if (decoded.baseUrl) baseUrlInput.value = decoded.baseUrl;
      if (decoded.endpointPath) currentConfig.endpointPath = C.normalizeEndpointPath(decoded.endpointPath);
      if (decoded.httpMethod) httpMethodSelect.value = decoded.httpMethod;
      if (decoded.headers) {
        const safeHeaders = Object.entries(decoded.headers)
          .filter(function (entry) { return !C.isSensitiveHeader(entry[0]); })
          .map(function (entry) { return { key: entry[0], value: entry[1] }; });
        currentConfig.headers = safeHeaders;
        const removedCount = Object.keys(decoded.headers).length - safeHeaders.length;
        if (removedCount > 0) {
          showToast('出于安全考虑，URL 中的 ' + removedCount + ' 个敏感请求头（如 Authorization）已被移除，请手动填写', 'warning');
        }
      }
      if (decoded.body) {
        currentConfig.body = decoded.body;
        currentConfig.customParams = decoded.customParams || [];
        renderFormMode();
        updateJsonPreview();
      }
      renderEndpoint();
      renderHeaders();
      updateFinalUrl();
      if (decoded.baseUrl) fetchModels();
    } catch (e) {
      console.warn('从 URL 参数恢复配置失败：', e.message);
    }
  }

  function buildShareUrl() {
    const config = {
      baseUrl: baseUrlInput.value.trim(),
      endpointPath: getEndpointPathValue(),
      httpMethod: httpMethodSelect.value,
      headers: {},
      body: C.deepClone(currentConfig.body)
    };
    currentConfig.headers.forEach(function (h) {
      if (h.key && !C.isSensitiveHeader(h.key)) {
        config.headers[h.key] = h.value;
      }
    });
    currentConfig.customParams.forEach(function (p) {
      config.body[p.key] = p.value;
    });
    const jsonStr = JSON.stringify(config);
    const encrypted = C.obfuscateValue(jsonStr);
    return location.origin + location.pathname + '?config=' + encodeURIComponent(encrypted);
  }

  // ==================== 配置加载/保存 ====================

  function loadSavedConfig(saved) {
    if (saved.baseUrl !== undefined) {
      baseUrlInput.value = saved.baseUrl;
      currentConfig.baseUrl = saved.baseUrl;
    }
    if (saved.endpointPath !== undefined) {
      currentConfig.endpointPath = C.normalizeEndpointPath(saved.endpointPath);
    }
    if (saved.httpMethod !== undefined) {
      httpMethodSelect.value = saved.httpMethod;
      currentConfig.httpMethod = saved.httpMethod;
    }
    if (saved.headers && Array.isArray(saved.headers)) {
      currentConfig.headers = saved.headers.map(function (h) { return { key: h.key, value: h.value }; });
      renderHeaders();
    }
    if (saved.body && typeof saved.body === 'object') {
      currentConfig.body = C.deepClone(saved.body);
    }
    if (saved.customParams && Array.isArray(saved.customParams)) {
      currentConfig.customParams = C.deepClone(saved.customParams);
    }

    if (currentConfig.body && typeof currentConfig.body === 'object') {
      const extracted = C.extractPresetParamsFromBody(currentConfig.body, currentConfig.endpointPath, currentConfig.customParams);
      currentConfig.body = extracted.body;
      currentConfig.customParams = extracted.customParams;
    }

    renderEndpoint();
    renderFormMode();
    updateFinalUrl();
    updateJsonPreview();
    showToast('配置已加载', 'success');

    if (saved.baseUrl) fetchModels();
  }

  // ==================== 请求构建与发送 ====================

  function buildRequestParams() {
    syncFormToConfig();

    const base = baseUrlInput.value.trim().replace(/\/+$/, '');
    const rawPath = getEndpointPathValue();
    const url = C.buildNormalizedEndpointPath(base, rawPath);

    const headers = {};
    currentConfig.headers.forEach(function (h) {
      if (!h.key) return;
      const sanitizedKey = h.key.replace(/[\r\n]/g, '');
      const sanitizedValue = String(h.value || '').replace(/[\r\n]/g, '');
      if (sanitizedKey) headers[sanitizedKey] = sanitizedValue;
    });

    let body = C.buildCompactBody(currentConfig.body);
    try {
      const parsed = JSON.parse(body);
      currentConfig.customParams.forEach(function (p) {
        if (p.value !== undefined && p.value !== null && p.value !== '') {
          parsed[p.key] = p.value;
        }
      });
      body = JSON.stringify(C.stripEmptyValues(parsed));
    } catch (e) {
      // 保持原样
    }

    return {
      url: url,
      method: httpMethodSelect.value,
      headers: headers,
      body: (httpMethodSelect.value === 'POST' || httpMethodSelect.value === 'PUT' || httpMethodSelect.value === 'PATCH') ? body : undefined
    };
  }

  function sanitizeHeadersForStorage(headers) {
    const sanitized = {};
    Object.entries(headers).forEach(function (entry) {
      const key = entry[0], val = entry[1];
      if (C.isSensitiveHeader(key)) {
        sanitized[key] = C.maskSensitiveValue(key, val);
      } else {
        sanitized[key] = val;
      }
    });
    return sanitized;
  }

  function revokeContainerBlobUrls() {
    responseContainer.querySelectorAll('img[src^="blob:"], audio[src^="blob:"], video[src^="blob:"]').forEach(function (el) {
      URL.revokeObjectURL(el.src);
    });
  }

  /**
   * 发送 API 调试请求
   * 构建请求参数、应用 API Key、使用 retryableFetch 进行带重试的请求，
   * 处理 SSE 流式响应、JSON、二进制等多种响应类型，
   * 记录历史、更新 UI 状态
   * @returns {Promise<void>}
   */
  async function sendRequest() {
    const params = buildRequestParams();
    if (!params.url) {
      showToast('请先填写 Base URL 和端点路径', 'error');
      return;
    }

    // 请求前校验
    const placeholderWarnings = checkPlaceholderApiKey();
    if (placeholderWarnings.length > 0) {
      const resolved = C.resolveApiKeyFromSources(['store', 'header'], currentConfig.headers);
      if (!resolved) {
        showToast('检测到 ' + placeholderWarnings.join('、') + ' 仍为占位符，请替换为真实的 API Key', 'error');
        return;
      }
    }

    const authHeader = currentConfig.headers.find(function (h) {
      return h.key && h.key.toLowerCase() === 'authorization';
    });
    if (authHeader) {
      const rawKey = String(authHeader.value).replace(/^Bearer\s+/i, '');
      const keyValidation = C.validateApiKey(rawKey);
      if (!keyValidation.valid && rawKey !== '' && rawKey !== C.PLACEHOLDER_API_KEY) {
        showToast('Authorization 密钥无效：' + keyValidation.error, 'warning');
      }
    }

    const dedupKey = C.getCacheKey(params.url, params.method, params.body);
    const existingPending = C.getPendingRequest('sendRequest:' + dedupKey);
    if (existingPending) {
      showToast('相同请求正在处理中，请稍候', 'warning');
      return;
    }

    let isStreaming = false;
    try {
      const bodyObj = JSON.parse(params.body || '{}');
      const streamVal = bodyObj.stream;
      isStreaming = streamVal === true || streamVal === 'true' || streamVal === 1;
    } catch (e) {
      // 忽略解析错误
    }

    abortController = new AbortController();
    sendBtn.disabled = true;
    abortBtn.disabled = false;
    requestStartTime = Date.now();
    streamingResponse = '';
    currentResponseData = null;
    currentRawResponseText = '';
    resetStreamElement();
    revokeContainerBlobUrls();
    clearElement(responseContainer);
    httpStatusSpan.textContent = '-';
    durationSpan.textContent = '-';

    const currentDedupKey = 'sendRequest:' + dedupKey;

    // 更新发送按钮状态
    clearElement(sendBtn);
    sendBtn.appendChild(C.createSpinner());
    sendBtn.appendChild(document.createTextNode('请求中…'));

    const timeoutId = setTimeout(function () {
      if (abortController) {
        abortController.abort();
        showToast('请求超时（' + (REQUEST_TIMEOUT_MS / 1000) + ' 秒），请检查网络或 API 服务状态', 'error');
      }
    }, REQUEST_TIMEOUT_MS);

    const requestHeaders = Object.assign({}, params.headers);

    const resolvedKey = C.resolveApiKeyFromSources(['store', 'header'], currentConfig.headers);
    if (resolvedKey && resolvedKey.key) {
      requestHeaders['Authorization'] = 'Bearer ' + resolvedKey.key;
    }

    if (!requestHeaders['Accept-Encoding']) {
      requestHeaders['Accept-Encoding'] = 'gzip, deflate';
    }
    if (params.method === 'POST' || params.method === 'PUT' || params.method === 'PATCH') {
      requestHeaders['Idempotency-Key'] = generateIdempotencyKey();
    }

    const options = {
      method: params.method,
      headers: requestHeaders,
      body: params.body,
      signal: abortController.signal
    };

    try {
      C.setPendingRequest(currentDedupKey, (async function () {
        const response = await C.retryableFetch(params.url, options, {
          maxRetries: MAX_RETRIES,
          retryableStatuses: RETRYABLE_STATUSES,
          onRetry: function (status, attempt, delay) {
            const displayStatus = status === 'NETWORK_ERROR' ? '网络错误' : status;
            showToast('遇到 ' + displayStatus + '，' + Math.round(delay / 1000) + ' 秒后重试 (' + (attempt + 1) + '/' + MAX_RETRIES + ')…', 'warning');
            clearElement(sendBtn);
            sendBtn.appendChild(C.createSpinner());
            sendBtn.appendChild(document.createTextNode('重试中 (' + (attempt + 1) + '/' + MAX_RETRIES + ')…'));
          }
        });
        return response;
      })());

      let response;
      try {
        response = await C.getPendingRequest(currentDedupKey);
      } catch (fetchErr) {
        if (fetchErr.name === 'AbortError') throw fetchErr;
        throw fetchErr;
      }

      clearTimeout(timeoutId);
      const httpStatus = response.status;
      httpStatusSpan.textContent = httpStatus;

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const isSse = contentType.includes('text/event-stream') || isStreaming;

      if (isSse && response.body) {
        await handleSseResponse(response);
        const duration = Date.now() - requestStartTime;
        durationSpan.textContent = duration + ' ms';
        addHistory(params, httpStatus, duration);
        return;
      }

      const responseClone = response.clone();
      const responseText = await response.text();
      currentRawResponseText = responseText;

      if (isJson) {
        currentResponseType = 'json';
        if (!responseText || responseText.trim() === '') {
          renderTextResponse('（服务器返回了空的 JSON 响应）', contentType);
          showToast('响应体为空，请检查请求参数或 API Key 是否有效', 'warning');
        } else {
          try {
            const json = JSON.parse(responseText);
            currentResponseData = json;
            renderResponse(json);
          } catch (parseErr) {
            renderTextResponse('JSON 解析失败：' + parseErr.message + '\n\n原始响应：\n' + responseText, contentType);
          }
        }
      } else if (contentType.includes('image/') || contentType.includes('audio/') || contentType.includes('video/')) {
        currentResponseType = 'blob';
        const blob = await responseClone.blob();
        currentResponseData = blob;
        renderBlobResponse(blob, contentType);
      } else {
        currentResponseType = 'text';
        currentResponseData = responseText;
        renderTextResponse(responseText, contentType);
      }

      const duration = Date.now() - requestStartTime;
      durationSpan.textContent = duration + ' ms';

      if (params.method === 'GET' && isJson && currentResponseData) {
        const cacheKey = C.getCacheKey(params.url, 'GET');
        C.setCachedResponse(cacheKey, currentResponseData);
      }

      addHistory(params, httpStatus, duration);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        showToast('请求已中止', 'info');
      } else if (isCorsError(err)) {
        showToast(getCorsErrorMessage('API 请求'), 'error');
      } else {
        showToast('请求失败：' + err.message, 'error');
      }
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = '发送请求';
      abortBtn.disabled = true;
      abortController = null;
      if (currentDedupKey) {
        C.removePendingRequest(currentDedupKey);
      }
    }
  }

  // ==================== SSE 处理 ====================

  /**
   * 处理 SSE (Server-Sent Events) 流式响应
   * 使用 AppConfig.parseSseStream 解析流，提取 delta 文本增量更新 UI，
   * 收集全部事件供后续分析
   * @param {Response} response
   */
  async function handleSseResponse(response) {
    const fullEvents = [];
    currentResponseType = 'stream';

    const result = await C.parseSseStream(response.body, {
      onDelta: function (deltaText, cumulativeContent) {
        streamingResponse = cumulativeContent;
        renderStreamingText(cumulativeContent);
      },
      onEvent: function (event) {
        fullEvents.push(event);
      }
    });

    streamingResponse = result.fullContent;
    currentResponseData = fullEvents;
    currentRawResponseText = fullEvents.map(function (e) { return JSON.stringify(e); }).join('\n');
    resetStreamElement();
    clearElement(responseContainer);
    if (result.fullContent) {
      const contentEl = createElement('div', { className: 'stream-content' });
      contentEl.appendChild(formatChatContent(result.fullContent));
      responseContainer.appendChild(contentEl);
    }
  }

  // ==================== 视图切换 ====================

  const appEl = document.querySelector('.app');
  const chatView = $('chatView');
  let currentView = 'debugger';

  function switchAppView(view) {
    if (view === currentView) return;
    currentView = view;

    if (view === 'chat') {
      appEl.classList.add('chat-mode');
      chatView.style.display = '';
      syncChatModelSelect();
    } else {
      appEl.classList.remove('chat-mode');
      chatView.style.display = 'none';
    }
  }

  // ==================== 对话模式 ====================

  const chatMessages = $('chatMessages');
  const chatInput = $('chatInput');
  const chatSendBtn = $('chatSendBtn');
  const chatStopBtn = $('chatStopBtn');
  const chatClearBtn = $('chatClearBtn');
  const chatSettingsBtn = $('chatSettingsBtn');
  const chatSettingsPanel = $('chatSettingsPanel');
  const chatModelSelect = $('chatModelSelect');
  const chatModelBadge = $('chatModelBadge');
  const chatTokenInfo = $('chatTokenInfo');
  const chatSystemPrompt = $('chatSystemPrompt');
  const chatTemperature = $('chatTemperature');
  const chatTemperatureVal = $('chatTemperatureVal');
  const chatMaxTokens = $('chatMaxTokens');
  const chatStreamToggle = $('chatStreamToggle');
  const chatEmptyState = $('chatEmptyState');

  let chatConversation = [];
  let chatAbortController = null;
  let chatIsGenerating = false;
  const chatHistoryPanel = $('chatHistoryPanel');
  const chatHistoryList = $('chatHistoryList');
  const chatHistoryBtn = $('chatHistoryBtn');
  const chatHistoryCloseBtn = $('chatHistoryCloseBtn');
  const chatHistorySearch = $('chatHistorySearch');
  const chatNewConversationBtn = $('chatNewConversationBtn');
  const chatClearAllHistoryBtn = $('chatClearAllHistoryBtn');
  let chatConversations = [];
  let chatActiveConversationId = null;

  let chatModelDropdown = null;

  function initChatModelDropdown() {
    const container = $('chatModelDropdown');
    if (!container) return;

    chatModelDropdown = C.createCustomDropdown({
      placeholder: '选择模型…',
      items: [],
      onChange: function (value) {
        chatModelSelect.value = value;
        updateChatModelBadge();
      }
    });

    container.appendChild(chatModelDropdown);
  }

  function syncChatModelSelect() {
    const currentModel = chatModelSelect.value;
    clearElement(chatModelSelect);
    const defaultOpt = createElement('option', { attrs: { value: '' }, text: '选择模型…' });
    chatModelSelect.appendChild(defaultOpt);

    const dropdownItems = [{ value: '', label: '选择模型…', placeholder: true }];
    var addedModels = {};

    if (fetchedModels.length > 0) {
      fetchedModels.forEach(function (m) {
        if (!addedModels[m]) {
          const opt = createElement('option', { attrs: { value: m }, text: m });
          if (m === currentModel) opt.selected = true;
          chatModelSelect.appendChild(opt);
          dropdownItems.push({ value: m, label: m });
          addedModels[m] = true;
        }
      });
    }

    var extraModelSources = [
      document.querySelector('[data-param="model"]'),
    ];
    try {
      var jsonVal = JSON.parse(requestJson.value);
      if (jsonVal && jsonVal.body && jsonVal.body.model) {
        extraModelSources.push({ value: jsonVal.body.model });
      }
    } catch (e) {}

    extraModelSources.forEach(function (src) {
      var val = src && src.value ? src.value : '';
      if (val && !addedModels[val]) {
        const opt = createElement('option', { attrs: { value: val }, text: val });
        if (val === currentModel) opt.selected = true;
        chatModelSelect.appendChild(opt);
        dropdownItems.push({ value: val, label: val });
        addedModels[val] = true;
      }
    });

    if (currentModel && !addedModels[currentModel]) {
      const opt = createElement('option', { attrs: { value: currentModel }, text: currentModel });
      opt.selected = true;
      chatModelSelect.appendChild(opt);
      dropdownItems.push({ value: currentModel, label: currentModel });
    }

    if (chatModelDropdown) {
      chatModelDropdown.updateItems(dropdownItems);
      chatModelDropdown.setValue(currentModel);
    }

    updateChatModelBadge();
  }

  function updateChatModelBadge() {
    const model = chatModelSelect.value;
    chatModelBadge.textContent = model || '未选择模型';
  }

  /**
   * 向聊天视图添加消息气泡
   * @param {string} role - 'user' | 'assistant' | 'system'
   * @param {string|DocumentFragment} content - 消息内容（纯文本或已格式化的 DocumentFragment）
   * @param {string} [meta] - 元信息文本（如耗时、token 统计）
   * @returns {{msgDiv: HTMLElement, contentDiv: HTMLElement, bubble: HTMLElement}}
   */
  function addChatMessage(role, content, meta) {
    if (chatEmptyState) {
      chatEmptyState.style.display = 'none';
    }

    const msgDiv = createElement('div', { className: 'chat-msg ' + role });
    const inner = createElement('div', { className: 'chat-msg-inner' });

    const avatarText = role === 'user' ? '你' : (role === 'system' ? '系' : 'AI');
    const avatar = createElement('div', { className: 'chat-msg-avatar', text: avatarText });

    const body = createElement('div', { className: 'chat-msg-body' });

    const roleLabel = role === 'user' ? '你' : (role === 'system' ? '系统' : '助手');
    const roleDiv = createElement('div', { className: 'chat-msg-role', text: roleLabel });

    const bubble = createElement('div', { className: 'chat-msg-bubble' });
    const contentDiv = createElement('div', { className: 'chat-msg-content' });
    contentDiv.appendChild(formatChatContent(content));
    bubble.appendChild(contentDiv);

    if (meta) {
      const metaDiv = createElement('div', { className: 'chat-msg-meta', text: meta });
      bubble.appendChild(metaDiv);
    }

    body.appendChild(roleDiv);
    body.appendChild(bubble);

    inner.appendChild(avatar);
    inner.appendChild(body);
    msgDiv.appendChild(inner);
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return { msgDiv: msgDiv, contentDiv: contentDiv, bubble: bubble };
  }

  /**
   * 安全地处理行内 Markdown 格式（**bold** 和 `code`）
   * 使用文本节点和样式元素构建 p 内容，不使用 innerHTML
   * @param {string} text - 单段文本
   * @param {HTMLElement} parentEl - 父元素（如 p）
   */
  function processInlineFormatting(text, parentEl) {
    const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let lastIdx = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > lastIdx) {
        parentEl.appendChild(document.createTextNode(text.substring(lastIdx, m.index)));
      }
      const matched = m[0];
      if (matched.startsWith('**') && matched.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = matched.substring(2, matched.length - 2);
        parentEl.appendChild(strong);
      } else if (matched.startsWith('`') && matched.endsWith('`')) {
        const code = document.createElement('code');
        code.textContent = matched.substring(1, matched.length - 1);
        parentEl.appendChild(code);
      }
      lastIdx = m.index + matched.length;
    }
    if (lastIdx < text.length) {
      parentEl.appendChild(document.createTextNode(text.substring(lastIdx)));
    }
  }

  /**
   * 将原始文本安全地格式化为 DOM 结构（DocumentFragment）
   * 处理：代码块（```）、段落分隔（双换行）、行内 Bold（**）和 Code（`）
   * 不使用 innerHTML，避免 XSS 风险
   * @param {string} text
   * @returns {DocumentFragment}
   */
  function formatChatContent(text) {
    const container = document.createDocumentFragment();
    if (!text) return container;

    const codeBlocks = [];
    let placeholderIndex = 0;
    const placeholderPrefix = '\x00CODEBLOCK\x00';

    let processedText = text.replace(/```(\w*)\n([\s\S]*?)```/g, function (match, lang, code) {
      codeBlocks.push({ lang: lang, code: code.trim() });
      return placeholderPrefix + (placeholderIndex++) + '\x00';
    });

    const thinkingBlocks = [];
    let thinkingIndex = 0;
    const thinkingPrefix = '\x00THINKING\x00';
    processedText = processedText.replace(/\[思考\]([^\x00]*?)(?=\n\n|$)/g, function (match, content) {
      thinkingBlocks.push(content.trim());
      return thinkingPrefix + (thinkingIndex++) + '\x00';
    });

    const paragraphs = processedText.split(/\n\n+/);
    paragraphs.forEach(function (para) {
      para = para.trim();
      if (!para) return;

      const codeBlockMatch = para.match(new RegExp(placeholderPrefix + '(\\d+)\x00'));
      if (codeBlockMatch) {
        const idx = parseInt(codeBlockMatch[1], 10);
        if (codeBlocks[idx]) {
          const pre = document.createElement('pre');
          const code = document.createElement('code');
          code.textContent = codeBlocks[idx].code;
          pre.appendChild(code);
          container.appendChild(pre);
        }
        return;
      }

      const thinkingMatch = para.match(new RegExp(thinkingPrefix + '(\\d+)\x00'));
      if (thinkingMatch) {
        const idx = parseInt(thinkingMatch[1], 10);
        if (thinkingBlocks[idx] !== undefined) {
          const details = document.createElement('details');
          details.className = 'thinking-block';
          const summary = document.createElement('summary');
          summary.textContent = '思考过程';
          details.appendChild(summary);
          const contentP = document.createElement('p');
          contentP.textContent = thinkingBlocks[idx];
          details.appendChild(contentP);
          container.appendChild(details);
        }
        return;
      }

      const segmentRegex = new RegExp(placeholderPrefix + '(\\d+)\x00|' + thinkingPrefix + '(\\d+)\x00', 'g');
      let segLastIdx = 0;
      let segMatch;
      const textSegments = [];
      while ((segMatch = segmentRegex.exec(para)) !== null) {
        if (segMatch.index > segLastIdx) {
          textSegments.push({ type: 'text', content: para.substring(segLastIdx, segMatch.index) });
        }
        if (segMatch[1] !== undefined) {
          textSegments.push({ type: 'codeblock', idx: parseInt(segMatch[1], 10) });
        } else if (segMatch[2] !== undefined) {
          textSegments.push({ type: 'thinking', idx: parseInt(segMatch[2], 10) });
        }
        segLastIdx = segMatch.index + segMatch[0].length;
      }
      if (segLastIdx < para.length) {
        textSegments.push({ type: 'text', content: para.substring(segLastIdx) });
      }

      textSegments.forEach(function (seg) {
        if (seg.type === 'codeblock') {
          if (codeBlocks[seg.idx]) {
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.textContent = codeBlocks[seg.idx].code;
            pre.appendChild(code);
            container.appendChild(pre);
          }
        } else if (seg.type === 'thinking') {
          if (thinkingBlocks[seg.idx] !== undefined) {
            const details = document.createElement('details');
            details.className = 'thinking-block';
            const summary = document.createElement('summary');
            summary.textContent = '思考过程';
            details.appendChild(summary);
            const contentP = document.createElement('p');
            contentP.textContent = thinkingBlocks[seg.idx];
            details.appendChild(contentP);
            container.appendChild(details);
          }
        } else {
          const p = document.createElement('p');
          const lines = seg.content.split('\n');
          lines.forEach(function (line, lineIdx) {
            if (lineIdx > 0) p.appendChild(document.createElement('br'));
            processInlineFormatting(line, p);
          });
          container.appendChild(p);
        }
      });
    });

    return container;
  }

  function updateChatMessageContent(contentDiv, text) {
    clearElement(contentDiv);
    contentDiv.appendChild(formatChatContent(text));
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function setChatGenerating(isGenerating) {
    chatIsGenerating = isGenerating;
    chatSendBtn.style.display = isGenerating ? 'none' : '';
    chatStopBtn.style.display = isGenerating ? '' : 'none';
    chatInput.disabled = isGenerating;
    if (!isGenerating) {
      chatInput.focus();
    }
  }

  /**
   * 发送聊天消息
   * 使用 retryableFetch 进行带重试的 API 调用，使用 parseSseStream 处理 SSE 流，
   * 支持非流式（JSON）和流式（SSE）两种模式
   * @param {number} [retryCount=0]
   * @returns {Promise<void>}
   */
  async function sendChatMessage(retryCount) {
    retryCount = retryCount || 0;
    const text = chatInput.value.trim();
    if (!text || chatIsGenerating) return;

    if (!chatModelSelect.value) {
      syncChatModelSelect();
    }
    const model = chatModelSelect.value;
    if (!model) {
      showToast('请先选择一个模型（在顶部模型选择器中选择）', 'error');
      return;
    }

    let apiKey = '';
    const resolved = C.resolveApiKeyFromSources(['store', 'header'], currentConfig.headers);
    if (resolved && resolved.key) {
      apiKey = resolved.key;
    }

    const keyValidation = C.validateApiKey(apiKey);
    if (!keyValidation.valid) {
      showToast('API Key 无效：' + keyValidation.error, 'error');
      return;
    }

    if (retryCount === 0) {
      chatInput.value = '';
      autoResizeChatInput();
      chatConversation.push({ role: 'user', content: text });
      addChatMessage('user', text);
    }

    const systemPrompt = chatSystemPrompt.value.trim();
    let apiMessages = [];
    if (systemPrompt) {
      apiMessages.push({ role: 'system', content: systemPrompt });
    }
    apiMessages = apiMessages.concat(chatConversation.slice());

    const temperature = parseFloat(chatTemperature.value) || 1;
    const maxTokens = parseInt(chatMaxTokens.value, 10) || 4096;
    const isStream = chatStreamToggle.checked;

    const baseUrl = baseUrlInput.value.trim().replace(/\/+$/, '');
    const url = C.buildNormalizedEndpointPath(baseUrl, 'chat/completions');

    const requestBody = C.stripEmptyValues({
      model: model,
      messages: apiMessages,
      temperature: temperature,
      max_completion_tokens: maxTokens,
      stream: isStream
    });

    chatAbortController = new AbortController();
    setChatGenerating(true);

    let assistantEls;
    if (retryCount === 0) {
      assistantEls = addChatMessage('assistant', '');
      const typingDiv = createElement('div', { className: 'chat-typing' });
      typingDiv.appendChild(C.createSpinner());
      assistantEls.contentDiv.appendChild(typingDiv);
    } else {
      const allMsgs = chatMessages.querySelectorAll('.chat-msg.assistant');
      const lastMsg = allMsgs[allMsgs.length - 1];
      assistantEls = {
        contentDiv: lastMsg.querySelector('.chat-msg-content'),
        bubble: lastMsg.querySelector('.chat-msg-bubble')
      };
      updateChatMessageContent(assistantEls.contentDiv, '重试中 (' + retryCount + '/' + C.CHAT_MAX_RETRIES + ')…');
    }

    const startTime = Date.now();

    try {
      const response = await C.retryableFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
          'Accept-Encoding': 'gzip, deflate'
        },
        body: JSON.stringify(requestBody),
        signal: chatAbortController.signal
      }, {
        maxRetries: C.CHAT_MAX_RETRIES,
        retryableStatuses: RETRYABLE_STATUSES,
        onRetry: function (status, attempt, delay) {
          const displayStatus = status === 'NETWORK_ERROR' ? '网络错误' : status;
          showToast('遇到 ' + displayStatus + '，' + Math.round(delay / 1000) + ' 秒后重试…', 'warning');
          updateChatMessageContent(assistantEls.contentDiv, '正在重试 (' + (attempt + 1) + '/' + C.CHAT_MAX_RETRIES + ')…');
        }
      });

      // 移除 typing 动画
      const typingEl = assistantEls.contentDiv.querySelector('.chat-typing');
      if (typingEl && typingEl.parentNode) {
        typingEl.parentNode.removeChild(typingEl);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error('HTTP ' + response.status + ': ' + errorText.substring(0, 200));
      }

      if (isStream && response.body) {
        // 使用共享 SSE 解析器
        let fullContent = '';
        let lastChatRenderLen = 0;
        let chatRafId = null;

        const result = await C.parseSseStream(response.body, {
          onDelta: function (deltaText, cumulativeContent) {
            fullContent = cumulativeContent;
            if (!chatRafId) {
              const capturedContent = fullContent;
              chatRafId = requestAnimationFrame(function () {
                chatRafId = null;
                updateChatMessageContent(assistantEls.contentDiv, capturedContent);
              });
            }
          },
          onEvent: function (event) {
            if (event.usage) {
              chatTokenInfo.textContent = 'Prompt: ' + (event.usage.prompt_tokens || '?') + ' / Completion: ' + (event.usage.completion_tokens || '?') + ' / Total: ' + (event.usage.total_tokens || '?');
            }
          }
        });

        if (chatRafId) cancelAnimationFrame(chatRafId);
        fullContent = result.fullContent;
        updateChatMessageContent(assistantEls.contentDiv, fullContent);
        chatConversation.push({ role: 'assistant', content: fullContent });
        const duration = Date.now() - startTime;
        const metaDiv = createElement('div', { className: 'chat-msg-meta', text: formatDuration(duration) });
        if (assistantEls.bubble) assistantEls.bubble.appendChild(metaDiv);

      } else {
        const json = await response.json();
        let content = '';
        if (json.choices && json.choices[0] && json.choices[0].message) {
          const msg = json.choices[0].message;
          const reasoning = msg.reasoning_content || '';
          const text = msg.content || '';
          if (reasoning) {
            content = '[思考] ' + reasoning + '\n\n' + text;
          } else {
            content = text;
          }
        }
        chatConversation.push({ role: 'assistant', content: content });
        updateChatMessageContent(assistantEls.contentDiv, content);

        const duration = Date.now() - startTime;
        let metaText = formatDuration(duration);
        if (json.usage) {
          metaText += ' · Prompt: ' + (json.usage.prompt_tokens || '?') + ' / Completion: ' + (json.usage.completion_tokens || '?') + ' / Total: ' + (json.usage.total_tokens || '?');
          chatTokenInfo.textContent = 'Total: ' + (json.usage.total_tokens || '?') + ' tokens';
        }
        const metaDiv = createElement('div', { className: 'chat-msg-meta', text: metaText });
        if (assistantEls.bubble) assistantEls.bubble.appendChild(metaDiv);
      }

    } catch (err) {
      const typingEl = assistantEls.contentDiv.querySelector('.chat-typing');
      if (typingEl && typingEl.parentNode) {
        typingEl.parentNode.removeChild(typingEl);
      }

      if (err.name === 'AbortError') {
        updateChatMessageContent(assistantEls.contentDiv, '（生成已中止）');
        const lastMsg = chatConversation[chatConversation.length - 1];
        if (!lastMsg || lastMsg.role !== 'assistant') {
          chatConversation.push({ role: 'assistant', content: '（生成已中止）' });
        }
      } else if (isCorsError(err)) {
        const corsMsg = getCorsErrorMessage('对话请求');
        updateChatMessageContent(assistantEls.contentDiv, corsMsg);
        chatConversation.push({ role: 'assistant', content: corsMsg });
        showToast(corsMsg, 'error');
      } else {
        updateChatMessageContent(assistantEls.contentDiv, '❌ 错误：' + err.message);
        chatConversation.push({ role: 'assistant', content: '错误：' + err.message });
      }
    } finally {
      chatAbortController = null;
      setChatGenerating(false);
      saveCurrentConversation();
    }
  }

  function formatDuration(ms) {
    if (ms < 1000) return ms + ' ms';
    return (ms / 1000).toFixed(1) + ' s';
  }

  function autoResizeChatInput() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
  }

  function clearChatConversation() {
    chatConversation = [];
    chatActiveConversationId = null;
    clearElement(chatMessages);
    if (chatEmptyState) {
      chatMessages.appendChild(chatEmptyState);
      chatEmptyState.style.display = '';
    }
    chatTokenInfo.textContent = '';
  }

  function loadChatConversations() {
    try {
      const data = localStorage.getItem('chat_conversations');
      chatConversations = data ? JSON.parse(data) : [];
    } catch (e) {
      chatConversations = [];
    }
  }

  function saveChatConversations() {
    try {
      localStorage.setItem('chat_conversations', JSON.stringify(chatConversations));
    } catch (e) {}
  }

  function saveCurrentConversation() {
    if (chatConversation.length === 0) return;

    let firstUserMsg = '';
    for (let i = 0; i < chatConversation.length; i++) {
      if (chatConversation[i].role === 'user') {
        firstUserMsg = chatConversation[i].content;
        break;
      }
    }

    const title = firstUserMsg.length > 40 ? firstUserMsg.substring(0, 40) + '…' : firstUserMsg;
    const model = chatModelSelect.value || '';
    const now = new Date();

    if (chatActiveConversationId) {
      for (let j = 0; j < chatConversations.length; j++) {
        if (chatConversations[j].id === chatActiveConversationId) {
          chatConversations[j].messages = chatConversation.slice();
          chatConversations[j].model = model;
          chatConversations[j].title = title;
          chatConversations[j].updatedAt = now.toISOString();
          break;
        }
      }
    } else {
      const conv = {
        id: 'conv-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        title: title,
        model: model,
        messages: chatConversation.slice(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };
      chatConversations.unshift(conv);
      chatActiveConversationId = conv.id;
    }

    saveChatConversations();
    renderChatHistory();
  }

  function loadConversation(convId) {
    let conv = null;
    for (let i = 0; i < chatConversations.length; i++) {
      if (chatConversations[i].id === convId) {
        conv = chatConversations[i];
        break;
      }
    }
    if (!conv) return;

    chatActiveConversationId = conv.id;
    chatConversation = conv.messages.slice();

    clearElement(chatMessages);
    if (chatEmptyState) chatEmptyState.style.display = 'none';

    chatConversation.forEach(function (msg) {
      addChatMessage(msg.role, msg.content);
    });

    if (conv.model) {
      const opts = chatModelSelect.querySelectorAll('option');
      let found = false;
      for (let k = 0; k < opts.length; k++) {
        if (opts[k].value === conv.model) { found = true; break; }
      }
      if (!found) {
        const opt = createElement('option', { attrs: { value: conv.model }, text: conv.model });
        chatModelSelect.appendChild(opt);
      }
      chatModelSelect.value = conv.model;
      updateChatModelBadge();
    }

    renderChatHistory();
  }

  function startNewConversation() {
    if (chatConversation.length > 0) {
      saveCurrentConversation();
    }
    chatActiveConversationId = null;
    clearChatConversation();
    renderChatHistory();
  }

  function deleteConversation(convId) {
    chatConversations = chatConversations.filter(function (c) { return c.id !== convId; });
    saveChatConversations();
    if (chatActiveConversationId === convId) {
      chatActiveConversationId = null;
      clearChatConversation();
    }
    renderChatHistory();
  }

  function clearAllConversations() {
    chatConversations = [];
    chatActiveConversationId = null;
    saveChatConversations();
    clearChatConversation();
    renderChatHistory();
  }

  function formatRelativeTime(isoStr) {
    try {
      const date = new Date(isoStr);
      const now = new Date();
      const diff = now - date;
      const minutes = Math.floor(diff / 60000);
      if (minutes < 1) return '刚刚';
      if (minutes < 60) return minutes + ' 分钟前';
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + ' 小时前';
      const days = Math.floor(hours / 24);
      if (days < 7) return days + ' 天前';
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  /**
   * 渲染聊天历史列表
   * 支持关键字搜索过滤，显示对话标题、预览、时间和模型信息
   * @param {string} [filter] - 搜索过滤关键字
   */
  function renderChatHistory(filter) {
    if (!chatHistoryList) return;
    clearElement(chatHistoryList);

    let filtered = chatConversations;
    if (filter) {
      const lowerFilter = filter.toLowerCase();
      filtered = chatConversations.filter(function (c) {
        return c.title.toLowerCase().indexOf(lowerFilter) !== -1 ||
               (c.model && c.model.toLowerCase().indexOf(lowerFilter) !== -1);
      });
    }

    if (filtered.length === 0) {
      const empty = createElement('div', { className: 'chat-history-empty' });
      const icon = createElement('div', {
        className: 'chat-history-empty-icon',
        html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
      });
      const text = createElement('div', {
        className: 'chat-history-empty-text',
        text: filter ? '没有匹配的对话' : '暂无历史对话'
      });
      empty.appendChild(icon);
      empty.appendChild(text);
      chatHistoryList.appendChild(empty);
      return;
    }

    filtered.forEach(function (conv) {
      const item = createElement('div', {
        className: 'chat-history-item' + (conv.id === chatActiveConversationId ? ' active' : ''),
        attrs: { 'data-conv-id': conv.id }
      });

      const title = createElement('div', {
        className: 'chat-history-item-title',
        text: conv.title || '未命名对话'
      });

      let preview = '';
      for (let p = 0; p < conv.messages.length; p++) {
        if (conv.messages[p].role === 'assistant') {
          preview = conv.messages[p].content;
          break;
        }
      }
      const previewEl = createElement('div', {
        className: 'chat-history-item-preview',
        text: preview.length > 60 ? preview.substring(0, 60) + '…' : preview
      });

      const meta = createElement('div', { className: 'chat-history-item-meta' });
      const time = createElement('span', { text: formatRelativeTime(conv.updatedAt || conv.createdAt) });
      meta.appendChild(time);
      if (conv.model) {
        const modelTag = createElement('span', {
          className: 'chat-history-item-model',
          text: conv.model
        });
        meta.appendChild(modelTag);
      }

      const delBtn = createElement('button', {
        className: 'chat-history-delete',
        attrs: { title: '删除对话', 'aria-label': '删除对话' },
        html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>'
      });

      item.appendChild(title);
      item.appendChild(previewEl);
      item.appendChild(meta);
      item.appendChild(delBtn);

      item.addEventListener('click', function (e) {
        if (e.target.closest('.chat-history-delete')) return;
        loadConversation(conv.id);
      });

      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        showConfirm('确定要删除这条对话吗？', function () {
          deleteConversation(conv.id);
          showToast('对话已删除', 'info');
        });
      });

      chatHistoryList.appendChild(item);
    });
  }

  function initChat() {
    if (!chatSendBtn) return;

    loadChatConversations();

    chatSendBtn.addEventListener('click', sendChatMessage);

    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });

    chatInput.addEventListener('input', autoResizeChatInput);

    chatStopBtn.addEventListener('click', function () {
      if (chatAbortController) {
        chatAbortController.abort();
      }
    });

    chatClearBtn.addEventListener('click', function () {
      if (chatConversation.length === 0) return;
      showConfirm('确定要清空当前对话吗？', clearChatConversation);
    });

    chatSettingsBtn.addEventListener('click', function () {
      chatHistoryPanel.style.display = 'none';
      chatSettingsPanel.style.display = '';
    });

    const chatSettingsCloseBtn = $('chatSettingsCloseBtn');
    if (chatSettingsCloseBtn) {
      chatSettingsCloseBtn.addEventListener('click', function () {
        chatSettingsPanel.style.display = 'none';
      });
    }

    if (chatHistoryBtn) {
      chatHistoryBtn.addEventListener('click', function () {
        chatSettingsPanel.style.display = 'none';
        const isVisible = chatHistoryPanel.style.display !== 'none';
        chatHistoryPanel.style.display = isVisible ? 'none' : '';
        if (!isVisible) {
          renderChatHistory();
        }
      });
    }

    if (chatHistoryCloseBtn) {
      chatHistoryCloseBtn.addEventListener('click', function () {
        chatHistoryPanel.style.display = 'none';
      });
    }

    if (chatNewConversationBtn) {
      chatNewConversationBtn.addEventListener('click', function () {
        startNewConversation();
      });
    }

    if (chatClearAllHistoryBtn) {
      chatClearAllHistoryBtn.addEventListener('click', function () {
        if (chatConversations.length === 0) return;
        showConfirm('确定要清空所有历史对话吗？此操作不可撤销。', function () {
          clearAllConversations();
          showToast('所有历史对话已清空', 'info');
        });
      });
    }

    if (chatHistorySearch) {
      chatHistorySearch.addEventListener('input', function () {
        renderChatHistory(chatHistorySearch.value.trim());
      });
    }

    document.querySelectorAll('.chat-hint-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        const hint = chip.getAttribute('data-hint') || '';
        if (hint) {
          chatInput.value = hint;
          autoResizeChatInput();
          chatInput.focus();
        }
      });
    });

    chatModelSelect.addEventListener('change', updateChatModelBadge);

    chatTemperature.addEventListener('input', function () {
      chatTemperatureVal.textContent = parseFloat(chatTemperature.value).toFixed(1);
    });

    syncChatModelSelect();
  }

  function setActiveTab(tab, bar) {
    if (!tab || !bar) return;
    bar.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
  }

  function switchView(view) {
    if (!currentResponseData && !currentRawResponseText && !streamingResponse) return;
    if (view === 'raw') {
      resetStreamElement();
      clearElement(responseContainer);
      const pre = createElement('pre', {
        className: 'response-pre'
      });
      if (currentResponseType === 'json' && currentResponseData) {
        pre.textContent = JSON.stringify(currentResponseData, null, 2);
      } else if (currentResponseType === 'blob') {
        pre.textContent = '[二进制数据] ' + (currentResponseData && currentResponseData.type ? currentResponseData.type : 'unknown') + '，大小: ' + (currentResponseData && currentResponseData.size ? currentResponseData.size : '?') + ' bytes';
      } else if (currentResponseType === 'stream') {
        pre.textContent = currentRawResponseText || streamingResponse || '';
      } else {
        pre.textContent = currentRawResponseText || String(currentResponseData);
      }
      responseContainer.appendChild(pre);
    } else {
      resetStreamElement();
      clearElement(responseContainer);
      if (currentResponseType === 'json' && currentResponseData) {
        var chatContent = extractChatContent(currentResponseData);
        if (chatContent) {
          const contentEl = createElement('div', { className: 'stream-content' });
          contentEl.appendChild(formatChatContent(chatContent));
          responseContainer.appendChild(contentEl);
        } else {
          renderResponse(currentResponseData);
        }
      } else if (currentResponseType === 'blob' && currentResponseData) {
        renderBlobResponse(currentResponseData, currentResponseData.type || 'application/octet-stream');
      } else if (currentResponseType === 'stream') {
        const fullContent = streamingResponse || '';
        if (fullContent) {
          const contentEl = createElement('div', { className: 'stream-content' });
          contentEl.appendChild(formatChatContent(fullContent));
          responseContainer.appendChild(contentEl);
        }
      } else {
        renderTextResponse(currentRawResponseText || '', 'text/plain');
      }
    }
  }

  // ==================== 面板管理 ====================

  function openPanel(panelId) {
    [savedConfigsPanel, historyPanel].forEach(function (panel) {
      if (panel) panel.classList.remove('open');
    });
    const targetPanel = $(panelId);
    if (targetPanel) {
      targetPanel.classList.add('open');
      targetPanel.setAttribute('aria-hidden', 'false');
    }
    if (panelOverlay) panelOverlay.classList.add('open');
  }

  function closeAllPanels() {
    [savedConfigsPanel, historyPanel].forEach(function (panel) {
      if (panel) {
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
      }
    });
    if (panelOverlay) panelOverlay.classList.remove('open');
  }

  function renderSidebarConfigs() {
    if (!configSubmenuList) return;
    const configs = C.loadSavedConfigs();
    clearElement(configSubmenuList);
    if (configs.length === 0) {
      const empty = createElement('div', {
        className: 'sidebar-config-item',
        styles: { cursor: 'default' }
      });
      const emptySpan = createElement('span', {
        className: 'config-name',
        styles: { color: 'var(--text-tertiary)' },
        text: '暂无保存的配置'
      });
      empty.appendChild(emptySpan);
      configSubmenuList.appendChild(empty);
      return;
    }
    configs.forEach(function (cfg) {
      const item = createElement('div', {
        className: 'sidebar-config-item',
        attrs: { role: 'button', tabindex: '0' }
      });
      const nameSpan = createElement('span', {
        className: 'config-name',
        text: cfg.name
      });
      const actionsSpan = createElement('span', { className: 'config-actions' });
      const delBtn = createElement('button', {
        attrs: {
          type: 'button',
          class: 'config-delete',
          'data-config-name': cfg.name,
          title: '删除'
        }
      });
      delBtn.appendChild(createDeleteIcon(14));
      actionsSpan.appendChild(delBtn);
      item.appendChild(nameSpan);
      item.appendChild(actionsSpan);

      item.addEventListener('click', function (e) {
        if (e.target.closest('.config-delete')) return;
        loadSavedConfig(cfg);
        showToast('配置「' + cfg.name + '」已加载', 'success');
      });
      item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (e.target.closest('.config-delete')) return;
          loadSavedConfig(cfg);
          showToast('配置「' + cfg.name + '」已加载', 'success');
        }
      });
      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const name = delBtn.dataset.configName;
        showConfirm('确定要删除配置「' + name + '」吗？', function () {
          C.deleteConfig(name);
          renderSidebarConfigs();
          renderConfigSelect();
          showToast('配置「' + name + '」已删除', 'info');
        });
      });
      configSubmenuList.appendChild(item);
    });
  }

  // ==================== 事件绑定 ====================

  function bindEndpointEvents() {
    baseUrlInput.addEventListener('input', updateFinalUrl);

    let fetchModelsTimer = null;
    baseUrlInput.addEventListener('input', function () {
      clearTimeout(fetchModelsTimer);
      const base = baseUrlInput.value.trim();
      if (!base) return;
      fetchModelsTimer = setTimeout(fetchModels, C.FETCH_MODELS_DEBOUNCE_MS);
    });

    fetchModelsBtn.addEventListener('click', fetchModels);

    endpointPathSelect.addEventListener('change', function () {
      const val = endpointPathSelect.value;
      const prevEndpoint = currentConfig.endpointPath;
      if (val === 'custom') {
        setEndpointMode(true, '');
        updateFinalUrl();
        return;
      }

      endpointPathInput.value = val;

      if (C.normalizeEndpointPath(val) === 'models') {
        httpMethodSelect.value = 'GET';
      } else if (val && val !== '' && val !== prevEndpoint) {
        httpMethodSelect.value = 'POST';
      }

      if (val && val !== '' && val !== prevEndpoint) {
        currentConfig.endpointPath = val;
        currentConfig.body = C.getEndpointDefaultBody(val);
        currentConfig.customParams = [];
        renderFormMode();
        updateJsonPreview();
      }
      updateFinalUrl();
    });

    endpointPathInput.addEventListener('input', function () {
      updateFinalUrl();
    });

    endpointPathInput.addEventListener('blur', function () {
      const presetOptions = Array.from(endpointPathSelect.options).map(function (o) { return o.value; });
      const val = endpointPathInput.value.trim();
      if (presetOptions.includes(val)) {
        setEndpointMode(false, val);
        endpointPathSelect.dispatchEvent(new Event('change'));
      }
    });
    httpMethodSelect.addEventListener('change', updateFinalUrl);
  }

  function bindHeaderEvents() {
    addHeaderBtn.addEventListener('click', function () {
      currentConfig.headers.push({ key: '', value: '' });
      renderHeaders();
    });

    headersContainer.addEventListener('click', function (e) {
      if (e.target.matches('.danger')) {
        const idx = +e.target.dataset.idx;
        if (!Number.isNaN(idx)) {
          currentConfig.headers.splice(idx, 1);
          renderHeaders();
        }
      }
    });

    headersContainer.addEventListener('input', function (e) {
      const idx = +e.target.dataset.idx;
      if (Number.isNaN(idx)) return;
      if (e.target.matches('.header-key')) {
        currentConfig.headers[idx].key = e.target.value;
      } else if (e.target.matches('.header-value')) {
        currentConfig.headers[idx].value = e.target.value;
      }
    });
  }

  function bindFormEvents() {
    formContainer.addEventListener('input', debouncedUpdateJsonPreview);
    modelRowContainer.addEventListener('input', debouncedUpdateJsonPreview);
    formContainer.addEventListener('change', function (e) {
      if (e.target.matches('select[data-param]')) {
        const select = e.target;
        const customInput = document.getElementById(select.id + '-custom');
        if (customInput) {
          customInput.style.display = select.value === '__custom__' ? '' : 'none';
          if (select.value !== '__custom__') {
            customInput.value = '';
          }
        }
        updateJsonPreview();
      }
    });

    addParamBtn.addEventListener('click', function () {
      currentConfig.customParams.push({ key: '', value: '' });
      renderFormMode();
      updateJsonPreview();
    });

    formContainer.addEventListener('click', function (e) {
      if (e.target.matches('.danger')) {
        let idx = +e.target.dataset.idx;
        if (Number.isNaN(idx)) idx = +e.target.dataset.customIdx;
        if (Number.isNaN(idx)) idx = +e.target.dataset.msgIdx;
        if (e.target.dataset.customIdx !== undefined) {
          currentConfig.customParams.splice(+e.target.dataset.customIdx, 1);
        } else if (e.target.dataset.msgIdx !== undefined) {
          currentConfig.body.messages.splice(+e.target.dataset.msgIdx, 1);
        }
        renderFormMode();
        updateJsonPreview();
      }
    });

    formatJsonBtn.addEventListener('click', function () {
      try {
        const obj = JSON.parse(requestJson.value);
        requestJson.value = JSON.stringify(obj, null, 2);
        jsonError.textContent = '';
      } catch (e) {
        jsonError.textContent = '格式化失败：' + e.message + '，请检查 JSON 语法是否正确';
      }
    });

    parseJsonBtn.addEventListener('click', function () {
      syncJsonToForm();
    });

    let jsonParseDebounceTimer = null;
    requestJson.addEventListener('input', function () {
      clearTimeout(jsonParseDebounceTimer);
      jsonParseDebounceTimer = setTimeout(function () {
        try {
          JSON.parse(requestJson.value);
          jsonError.textContent = '';
          debouncedSyncJsonToForm();
        } catch (e) {
          jsonError.textContent = 'JSON 语法错误：' + e.message;
        }
      }, C.JSON_SYNC_DELAY_MS);
    });

    sendBtn.addEventListener('click', sendRequest);
    abortBtn.addEventListener('click', function () {
      if (abortController) abortController.abort();
    });

    historyList.addEventListener('click', function (e) {
      const li = e.target.closest('li');
      if (!li) return;
      const id = +li.dataset.id;
      if (!Number.isNaN(id)) loadHistoryToConfig(id);
    });

    historyList.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const li = e.target.closest('li');
        if (!li) return;
        const id = +li.dataset.id;
        if (!Number.isNaN(id)) loadHistoryToConfig(id);
      }
    });

    baseUrlInput.addEventListener('input', debouncedUpdateJsonPreview);
    endpointPathInput.addEventListener('input', debouncedUpdateJsonPreview);
    endpointPathSelect.addEventListener('change', updateJsonPreview);
    httpMethodSelect.addEventListener('change', updateJsonPreview);

    headersContainer.addEventListener('input', debouncedUpdateJsonPreview);
    headersContainer.addEventListener('click', function () {
      setTimeout(updateJsonPreview, 0);
    });
    addHeaderBtn.addEventListener('click', function () {
      setTimeout(updateJsonPreview, 0);
    });

    clearHistoryBtn.addEventListener('click', function () {
      showConfirm('确定要清空所有历史记录吗？此操作不可撤销。', function () {
        requestHistory = [];
        C.saveHistory(requestHistory);
        renderHistory();
        showToast('历史记录已清空', 'info');
      });
    });

    exportHistoryBtn.addEventListener('click', function () {
      const safeHistory = requestHistory.map(function (item) {
        const safeItem = Object.assign({}, item);
        if (safeItem.headers) {
          const safeHeaders = {};
          Object.entries(safeItem.headers).forEach(function (entry) {
            const key = entry[0], val = entry[1];
            if (!C.isSensitiveHeader(key)) {
              safeHeaders[key] = val;
            } else {
              safeHeaders[key] = val.replace(/./g, '*').substring(0, 8) + '…';
            }
          });
          safeItem.headers = safeHeaders;
        }
        return safeItem;
      });
      const blob = new Blob([JSON.stringify(safeHistory, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = createElement('a', { attrs: { href: url, download: 'openai_debugger_history.json' } });
      a.click();
      URL.revokeObjectURL(url);
      showToast('历史记录已导出（敏感信息已脱敏）', 'success');
    });
  }

  function bindConfigEvents() {
    shareUrlBtn.addEventListener('click', function () {
      syncFormToConfig();
      const url = buildShareUrl();
      showConfirm('分享链接会将 Base URL、端点路径和请求参数（含 messages 内容）编码到 URL 中，该内容可能被浏览器历史、服务器日志等记录。确定要复制分享链接吗？', function () {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            showToast('分享链接已复制到剪贴板', 'success');
          }).catch(function () {
            prompt('复制链接（请手动复制）：', url);
          });
        } else {
          prompt('复制链接（请手动复制）：', url);
        }
      });
    });

    saveConfigBtn.addEventListener('click', function () {
      const name = configNameInput.value.trim();
      if (!name) {
        showToast('请输入配置名称', 'error');
        return;
      }
      syncFormToConfig();
      const configData = C.buildConfigData(
        baseUrlInput.value.trim(),
        getEndpointPathValue(),
        httpMethodSelect.value,
        currentConfig.headers,
        currentConfig.body,
        currentConfig.customParams
      );
      const action = C.saveConfig(name, configData);
      renderConfigSelect();
      renderSidebarConfigs();
      configNameInput.value = '';
      showToast('配置「' + name + '」已' + action, 'success');
    });

    loadConfigBtn.addEventListener('click', function () {
      const name = configSelect.value;
      if (!name) {
        showToast('请选择一个配置', 'error');
        return;
      }
      const saved = C.getConfigByName(name);
      if (!saved) {
        showToast('配置不存在', 'error');
        return;
      }
      loadSavedConfig(saved);
    });

    deleteConfigBtn.addEventListener('click', function () {
      const name = configSelect.value;
      if (!name) {
        showToast('请选择一个配置', 'error');
        return;
      }
      showConfirm('确定要删除配置「' + name + '」吗？', function () {
        C.deleteConfig(name);
        renderConfigSelect();
        renderSidebarConfigs();
        configSelect.value = '';
        showToast('配置「' + name + '」已删除', 'info');
      });
    });

    exportConfigBtn.addEventListener('click', function () {
      syncFormToConfig();
      const configData = {
        baseUrl: baseUrlInput.value.trim(),
        endpointPath: getEndpointPathValue(),
        httpMethod: httpMethodSelect.value,
        headers: currentConfig.headers.map(function (h) {
          if (C.isSensitiveHeader(h.key)) {
            return { key: h.key, value: C.maskSensitiveValue(h.key, h.value) };
          }
          return { key: h.key, value: h.value };
        }),
        body: C.deepClone(currentConfig.body),
        customParams: C.deepClone(currentConfig.customParams)
      };
      const blob = new Blob([JSON.stringify(configData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = createElement('a', { attrs: { href: url, download: 'openai_config_' + new Date().toISOString().slice(0, 10) + '.json' } });
      a.click();
      URL.revokeObjectURL(url);
      showToast('配置已导出（敏感请求头已脱敏）', 'success');
    });

    importConfigBtn.addEventListener('click', function () {
      importConfigFile.click();
    });

    importConfigFile.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function (event) {
        try {
          const configData = JSON.parse(event.target.result);
          loadSavedConfig(configData);
          showToast('配置已导入', 'success');
        } catch (err) {
          showToast('导入失败：' + err.message, 'error');
        }
        importConfigFile.value = '';
      };
      reader.readAsText(file);
    });
  }

  function bindResponseTabEvents() {
    const responseBar = document.querySelector('.response-card .tab-bar');
    if (responseBar) {
      responseBar.addEventListener('click', function (e) {
        if (e.target.matches('.tab')) {
          const view = e.target.dataset.view;
          if (view) switchView(view);
          setActiveTab(e.target, responseBar);
        }
      });
    }
  }

  // ==================== 文件上传 ====================

  function getUploadAccept(type) {
    switch (type) {
      case 'image': return 'image/*';
      case 'audio': return 'audio/*';
      case 'video': return 'video/*';
      default: return '*/*';
    }
  }

  function getUploadHint(type) {
    switch (type) {
      case 'image': return '支持 JPG、PNG、GIF、WEBP 格式';
      case 'audio': return '支持 MP3、WAV、OGG、M4A 格式';
      case 'video': return '支持 MP4、WEBM、OGG 格式';
      default: return '支持常见格式';
    }
  }

  function revokeUploadedBlobUrls() {
    uploadedFiles.forEach(function (f) {
      if (f.blobUrl) URL.revokeObjectURL(f.blobUrl);
      if (f.dataUrl && f.dataUrl.startsWith('blob:')) URL.revokeObjectURL(f.dataUrl);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const result = reader.result;
        const base64 = result.substring(result.indexOf(',') + 1);
        resolve({ dataUrl: result, base64: base64 });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function createFileInfo(file) {
    return {
      name: file.name,
      type: file.type,
      size: file.size,
      file: file,
      blobUrl: URL.createObjectURL(file),
      dataUrl: null,
      base64: null
    };
  }

  function renderUploadPreview() {
    clearElement(uploadPreview);
    uploadedFiles.forEach(function (fileInfo, idx) {
      const item = createElement('div', { className: 'upload-preview-item' });
      if (fileInfo.type.startsWith('image/')) {
        const img = createElement('img', { attrs: { src: fileInfo.blobUrl || fileInfo.dataUrl, alt: fileInfo.name } });
        item.appendChild(img);
      } else if (fileInfo.type.startsWith('video/')) {
        const video = createElement('video', { attrs: { src: fileInfo.blobUrl || fileInfo.dataUrl } });
        item.appendChild(video);
      } else if (fileInfo.type.startsWith('audio/')) {
        const audio = createElement('audio', { attrs: { controls: true, src: fileInfo.blobUrl || fileInfo.dataUrl } });
        item.appendChild(audio);
      }
      const nameSpan = createElement('span', { className: 'file-name', text: fileInfo.name });
      item.appendChild(nameSpan);
      const removeBtn = createElement('button', {
        className: 'remove-file',
        text: '×',
        attrs: { 'aria-label': '删除文件', title: '删除' }
      });
      removeBtn.addEventListener('click', function () {
        const removed = uploadedFiles[idx];
        if (removed && removed.blobUrl) URL.revokeObjectURL(removed.blobUrl);
        if (removed && removed.dataUrl && removed.dataUrl.startsWith('blob:')) URL.revokeObjectURL(removed.dataUrl);
        uploadedFiles.splice(idx, 1);
        renderUploadPreview();
      });
      item.appendChild(removeBtn);
      uploadPreview.appendChild(item);
    });
  }

  function handleFiles(files) {
    const maxFileSize = C.MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024;
    const maxTotalSize = C.MAX_UPLOAD_TOTAL_SIZE_MB * 1024 * 1024;

    const validFiles = Array.from(files).filter(function (file) {
      if (currentUploadType === 'image' && !file.type.startsWith('image/')) {
        showToast('「' + file.name + '」不是图片文件，已跳过', 'warning');
        return false;
      }
      if (currentUploadType === 'audio' && !file.type.startsWith('audio/')) {
        showToast('「' + file.name + '」不是音频文件，已跳过', 'warning');
        return false;
      }
      if (currentUploadType === 'video' && !file.type.startsWith('video/')) {
        showToast('「' + file.name + '」不是视频文件，已跳过', 'warning');
        return false;
      }
      if (file.size > maxFileSize) {
        showToast('「' + file.name + '」超过 ' + C.MAX_UPLOAD_FILE_SIZE_MB + 'MB 限制（当前 ' + (file.size / 1024 / 1024).toFixed(1) + 'MB），已跳过', 'warning');
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    const currentTotalSize = uploadedFiles.reduce(function (sum, f) { return sum + f.size; }, 0);
    const newTotalSize = currentTotalSize + validFiles.reduce(function (sum, f) { return sum + f.size; }, 0);
    if (newTotalSize > maxTotalSize) {
      showToast('上传文件总大小超过 ' + C.MAX_UPLOAD_TOTAL_SIZE_MB + 'MB 限制，请减少文件数量或大小', 'error');
      return;
    }

    const newFiles = validFiles.map(function (file) {
      return createFileInfo(file);
    });

    uploadedFiles = uploadedFiles.concat(newFiles);
    renderUploadPreview();
    showToast('已添加 ' + newFiles.length + ' 个文件', 'success');
  }

  function insertFilesToMessages() {
    if (uploadedFiles.length === 0) {
      showToast('请先上传文件', 'warning');
      return;
    }

    const endpointPath = C.normalizeEndpointPath(getEndpointPathValue());
    if (endpointPath !== 'chat/completions' && endpointPath !== 'responses') {
      showToast('当前端点不支持多模态消息，请切换到 chat/completions 或 responses', 'warning');
      return;
    }

    if (!currentConfig.body.messages || !Array.isArray(currentConfig.body.messages)) {
      currentConfig.body.messages = [];
    }

    var pendingCount = uploadedFiles.filter(function (f) { return !f.dataUrl; }).length;
    if (pendingCount > 0) {
      showToast('正在处理 ' + pendingCount + ' 个文件…', 'info');
    }

    var readPromises = uploadedFiles.map(function (file) {
      if (file.dataUrl) return Promise.resolve(file);
      return readFileAsDataUrl(file.file).then(function (result) {
        file.dataUrl = result.dataUrl;
        file.base64 = result.base64;
        if (file.blobUrl) {
          URL.revokeObjectURL(file.blobUrl);
          file.blobUrl = null;
        }
        return file;
      });
    });

    Promise.all(readPromises).then(function () {
      var contentArray = uploadedFiles.map(function (file) {
        if (file.type.startsWith('image/')) {
          return {
            type: 'image_url',
            image_url: { url: file.dataUrl, detail: 'auto' }
          };
        }
        if (file.type.startsWith('audio/')) {
          var format = file.type.split('/')[1] || 'mp3';
          if (format === 'mpeg') format = 'mp3';
          if (format === 'x-wav' || format === 'wav') format = 'wav';
          return {
            type: 'input_audio',
            input_audio: { data: file.base64, format: format }
          };
        }
        if (file.type.startsWith('video/')) {
          return {
            type: 'image_url',
            image_url: { url: file.dataUrl, detail: 'auto' }
          };
        }
        return {
          type: 'image_url',
          image_url: { url: file.dataUrl, detail: 'auto' }
        };
      });

      contentArray.push({ type: 'text', text: '' });

      currentConfig.body.messages.push({
        role: 'user',
        content: contentArray
      });

      renderFormMode();
      updateJsonPreview();
      showToast('文件已插入到 messages（最后一条 user 消息）', 'success');
    }).catch(function (err) {
      showToast('文件处理失败：' + err.message, 'error');
    });
  }

  function bindUploadEvents() {
    document.querySelectorAll('.upload-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.upload-tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        currentUploadType = tab.dataset.uploadType;
        fileInput.accept = getUploadAccept(currentUploadType);
        uploadHint.textContent = getUploadHint(currentUploadType);
      });
    });

    if (uploadDropzone) {
      uploadDropzone.addEventListener('click', function () {
        fileInput.click();
      });

      uploadDropzone.addEventListener('dragover', function (e) {
        e.preventDefault();
        uploadDropzone.classList.add('dragover');
      });

      uploadDropzone.addEventListener('dragleave', function () {
        uploadDropzone.classList.remove('dragover');
      });

      uploadDropzone.addEventListener('drop', function (e) {
        e.preventDefault();
        uploadDropzone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', function (e) {
        handleFiles(e.target.files);
        fileInput.value = '';
      });
    }

    if (clearFilesBtn) {
      clearFilesBtn.addEventListener('click', function () {
        revokeUploadedBlobUrls();
        uploadedFiles = [];
        renderUploadPreview();
        showToast('已清空上传文件', 'info');
      });
    }

    if (insertFilesBtn) {
      insertFilesBtn.addEventListener('click', insertFilesToMessages);
    }
  }

  // ==================== 侧边栏管理 ====================

  function initSidebar() {
    if (sidebarCollapseBtn && sidebarEl) {
      const savedCollapsed = localStorage.getItem('sidebar_collapsed');
      if (savedCollapsed === 'true') {
        sidebarEl.classList.add('collapsed');
        sidebarCollapseBtn.title = '展开侧边栏';
        sidebarCollapseBtn.setAttribute('aria-label', '展开侧边栏');
      }

      sidebarCollapseBtn.addEventListener('click', function () {
        const isCollapsed = sidebarEl.classList.toggle('collapsed');
        sidebarCollapseBtn.title = isCollapsed ? '展开侧边栏' : '收起侧边栏';
        sidebarCollapseBtn.setAttribute('aria-label', isCollapsed ? '展开侧边栏' : '收起侧边栏');
        try {
          localStorage.setItem('sidebar_collapsed', isCollapsed ? 'true' : 'false');
        } catch (e) {}
      });
    }

    sidebarItems.forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        const panel = item.dataset.panel;

        sidebarItems.forEach(function (i) { i.classList.remove('active'); });
        item.classList.add('active');

        if (panel === 'config') {
          closeAllPanels();
          switchAppView('debugger');
        } else if (panel === 'chat') {
          closeAllPanels();
          switchAppView('chat');
        } else if (panel === 'history') {
          openPanel('historyPanel');
        }
      });
    });

    if (configExpandBtn) {
      configExpandBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        configExpandBtn.classList.toggle('expanded');
        if (configSubmenu) {
          configSubmenu.classList.toggle('open');
          if (configSubmenu.classList.contains('open')) {
            renderSidebarConfigs();
          }
        }
      });
    }

    if (quickSaveConfigBtn) {
      quickSaveConfigBtn.addEventListener('click', function () {
        const name = quickConfigName.value.trim();
        if (!name) {
          showToast('请输入配置名称', 'error');
          return;
        }
        syncFormToConfig();
        const configData = C.buildConfigData(
          baseUrlInput.value.trim(),
          getEndpointPathValue(),
          httpMethodSelect.value,
          currentConfig.headers,
          currentConfig.body,
          currentConfig.customParams
        );
        const action = C.saveConfig(name, configData);
        renderSidebarConfigs();
        renderConfigSelect();
        quickConfigName.value = '';
        showToast('配置「' + name + '」已' + action, 'success');
      });
    }

    if (panelOverlay) {
      panelOverlay.addEventListener('click', function () {
        closeAllPanels();
        sidebarItems.forEach(function (i) { i.classList.remove('active'); });
        const configItem = document.querySelector('.sidebar-item[data-panel="config"]');
        if (configItem) configItem.classList.add('active');
        switchAppView('debugger');
      });
    }

    document.querySelectorAll('.side-panel-close').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeAllPanels();
        sidebarItems.forEach(function (i) { i.classList.remove('active'); });
        const configItem = document.querySelector('.sidebar-item[data-panel="config"]');
        if (configItem) configItem.classList.add('active');
        switchAppView('debugger');
      });
    });
  }

  // ==================== 密钥管理 ====================

  const apiKeyListEl = $('apiKeyList');
  const newApiKeyNameEl = $('newApiKeyName');
  const newApiKeyProviderEl = $('newApiKeyProvider');
  const newApiKeyValueEl = $('newApiKeyValue');
  const saveApiKeyBtnEl = $('saveApiKeyBtn');
  const toggleKeyVisibilityEl = $('toggleKeyVisibility');

  function renderApiKeyList() {
    if (!apiKeyListEl) return;
    clearElement(apiKeyListEl);

    const keys = C.listApiKeys();
    const store = C.loadApiKeyStore();
    const activeKeyId = store ? store.activeKeyId : null;

    if (keys.length === 0) {
      const empty = createElement('div', { className: 'apikey-empty', text: '暂无已保存的密钥，请在下方添加' });
      apiKeyListEl.appendChild(empty);
      return;
    }

    keys.forEach(function (k) {
      const item = createElement('div', {
        className: 'apikey-item' + (k.id === activeKeyId ? ' active' : '')
      });

      const info = createElement('div', { className: 'apikey-item-info' });
      const nameEl = createElement('div', { className: 'apikey-item-name', text: k.name });
      const metaEl = createElement('div', {
        className: 'apikey-item-meta',
        text: (k.provider || 'openai').toUpperCase() + ' · ' + k.masked
      });
      info.appendChild(nameEl);
      info.appendChild(metaEl);

      const actions = createElement('div', { className: 'apikey-item-actions' });
      const activateBtn = createElement('button', {
        className: k.id === activeKeyId ? 'primary' : 'secondary',
        text: k.id === activeKeyId ? '使用中' : '使用'
      });
      activateBtn.addEventListener('click', function () {
        C.setActiveApiKey(k.id);
        applyActiveKeyToHeaders(k.id);
        renderApiKeyList();
        showToast('已切换到密钥：' + k.name, 'success');
      });
      const deleteBtn = createElement('button', {
        className: 'danger',
        text: '删除'
      });
      deleteBtn.addEventListener('click', function () {
        C.deleteApiKey(k.id);
        renderApiKeyList();
        showToast('已删除密钥：' + k.name, 'info');
      });
      actions.appendChild(activateBtn);
      actions.appendChild(deleteBtn);

      item.appendChild(info);
      item.appendChild(actions);
      apiKeyListEl.appendChild(item);
    });
  }

  function applyActiveKeyToHeaders(keyId) {
    const key = C.getApiKey(keyId);
    if (!key) return;
    const authHeader = currentConfig.headers.find(function (h) {
      return h.key && h.key.toLowerCase() === 'authorization';
    });
    if (authHeader) {
      authHeader.value = 'Bearer ' + key;
      renderHeaders();
      updateJsonPreview();
    }
  }

  function initApiKeyManager() {
    renderApiKeyList();

    if (saveApiKeyBtnEl) {
      saveApiKeyBtnEl.addEventListener('click', function () {
        const name = newApiKeyNameEl.value.trim();
        const value = newApiKeyValueEl.value.trim();
        const provider = newApiKeyProviderEl.value;

        if (!name) {
          showToast('请输入密钥名称', 'error');
          return;
        }
        const validation = C.validateApiKey(value);
        if (!validation.valid) {
          showToast('密钥无效：' + validation.error, 'error');
          return;
        }

        const id = C.saveApiKey(name, value, provider);
        newApiKeyNameEl.value = '';
        newApiKeyValueEl.value = '';
        renderApiKeyList();
        applyActiveKeyToHeaders(id);
        showToast('密钥已保存：' + name, 'success');
      });
    }

    if (toggleKeyVisibilityEl) {
      toggleKeyVisibilityEl.addEventListener('click', function () {
        if (newApiKeyValueEl.type === 'password') {
          newApiKeyValueEl.type = 'text';
        } else {
          newApiKeyValueEl.type = 'password';
        }
      });
    }
  }

  // ==================== 初始化 ====================

  function init() {
    if (!C.isLocalStorageAvailable()) {
      showToast('浏览器存储不可用，配置和历史记录将无法保存。请检查是否处于隐私模式。', 'warning');
    }
    clearElement(endpointPathSelect);
    endpointPathSelect.appendChild(C.buildEndpointSelectOptions());
    renderEndpoint();
    renderHeaders();
    renderFormMode();
    renderHistory();
    renderConfigSelect();
    updateFinalUrl();
    updateJsonPreview();

    bindEndpointEvents();
    bindHeaderEvents();
    bindFormEvents();
    bindConfigEvents();
    bindResponseTabEvents();

    const uploadMgr = window.UploadManager && window.UploadManager.create({
      fileInput: fileInput,
      uploadDropzone: uploadDropzone,
      uploadPreview: uploadPreview,
      uploadHint: uploadHint,
      clearFilesBtn: clearFilesBtn,
      insertFilesBtn: insertFilesBtn,
      showToast: showToast,
      createElement: createElement,
      clearElement: C.clearElement,
      maxFileSizeMB: C.MAX_UPLOAD_FILE_SIZE_MB,
      maxTotalSizeMB: C.MAX_UPLOAD_TOTAL_SIZE_MB,
      getEndpointPath: function () { return getEndpointPathValue(); },
      getUploadType: function () { return currentUploadType; },
      onFilesInserted: function (contentArray) {
        if (!currentConfig.body.messages || !Array.isArray(currentConfig.body.messages)) {
          currentConfig.body.messages = [];
        }
        currentConfig.body.messages.push({ role: 'user', content: contentArray });
        renderFormMode();
        updateJsonPreview();
        showToast('文件已插入到 messages（最后一条 user 消息）', 'success');
      }
    });
    if (uploadMgr) {
      uploadedFiles = uploadMgr.getUploadedFiles;
      currentUploadType = uploadMgr.getUploadType;
    } else {
      bindUploadEvents();
    }

    const shareMgr = window.ShareManager && window.ShareManager.create({
      shareBtn: shareUrlBtn,
      showToast: showToast,
      getConfigData: function () {
        syncFormToConfig();
        const config = {
          baseUrl: baseUrlInput.value.trim(),
          endpointPath: getEndpointPathValue(),
          httpMethod: httpMethodSelect.value,
          headers: {},
          body: C.deepClone(currentConfig.body)
        };
        currentConfig.headers.forEach(function (h) {
          if (h.key && !C.isSensitiveHeader(h.key)) {
            config.headers[h.key] = h.value;
          }
        });
        currentConfig.customParams.forEach(function (p) {
          config.body[p.key] = p.value;
        });
        return config;
      },
      applyConfig: function (decoded) {
        if (decoded.baseUrl) baseUrlInput.value = decoded.baseUrl;
        if (decoded.endpointPath) currentConfig.endpointPath = C.normalizeEndpointPath(decoded.endpointPath);
        if (decoded.httpMethod) httpMethodSelect.value = decoded.httpMethod;
        if (decoded.headers) {
          const safeHeaders = Object.entries(decoded.headers)
            .filter(function (entry) { return !C.isSensitiveHeader(entry[0]); })
            .map(function (entry) { return { key: entry[0], value: entry[1] }; });
          currentConfig.headers = safeHeaders;
          const removedCount = Object.keys(decoded.headers).length - safeHeaders.length;
          if (removedCount > 0) {
            showToast('出于安全考虑，URL 中的 ' + removedCount + ' 个敏感请求头已被移除，请手动填写', 'warning');
          }
        }
        if (decoded.body) {
          currentConfig.body = decoded.body;
          currentConfig.customParams = decoded.customParams || [];
          renderFormMode();
          updateJsonPreview();
        }
        renderEndpoint();
        renderHeaders();
        updateFinalUrl();
        if (decoded.baseUrl) fetchModels();
      }
    });
    if (shareMgr) {
      restoreFromUrlParams = shareMgr.restoreFromUrlParams;
      buildShareUrl = shareMgr.buildShareUrl;
    }

    initSidebar();
    initChat();
    initChatModelDropdown();
    initApiKeyManager();

    restoreFromUrlParams();
  }

  init();
})();