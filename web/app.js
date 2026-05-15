// app.js – 主逻辑
;(function () {
  'use strict';

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  let currentConfig = createDefaultConfig();
  let history = loadHistory();

  let abortController = null;
  let requestStartTime = null;
  let streamingResponse = '';
  let currentResponseData = null;
  let currentResponseType = 'json';
  let currentRawResponseText = '';
  let fetchedModels = [];

  const $ = id => document.getElementById(id);

  const baseUrlInput = $('baseUrl');
  const endpointPathInput = $('endpointPath');
  const endpointPathSelect = $('endpointPathSelect');
  const httpMethodSelect = $('httpMethod');
  const finalUrlSpan = $('finalUrl');
  const headersContainer = $('headersContainer');
  const addHeaderBtn = $('addHeaderBtn');

  const formModeSections = document.querySelectorAll('.form-mode');
  const jsonMode = $('jsonMode');
  const formContainer = $('formContainer');
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

  const REQUEST_TIMEOUT_MS = 60000;
  const MAX_RETRIES = 3;
  const ENABLE_IDEMPOTENCY_KEY = true;

  const PRESET_OPTIONS_HTML = '<option value="">-- 添加常用自定义参数 --</option>' +
    CUSTOM_PARAM_PRESETS.map((preset, idx) => '<option value="' + idx + '">' + escapeHtml(preset.key) + ' - ' + escapeHtml(preset.description) + '</option>').join('');

  function generateIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function debounce(fn, delay) {
    let timer = null;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
  }

  async function fetchModels() {
    const base = baseUrlInput.value.trim().replace(/\/+$/, '');
    if (!base) {
      modelFetchStatus.textContent = '';
      modelFetchStatus.className = 'fetch-status';
      return;
    }

    const url = base + '/models';

    const headers = {};
    currentConfig.headers.forEach(h => {
      if (h.key) headers[h.key] = h.value;
    });

    modelFetchStatus.textContent = '正在获取模型列表…';
    modelFetchStatus.className = 'fetch-status loading';
    fetchModelsBtn.disabled = true;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' ' + response.statusText);
      }

      const data = await response.json();

      let models = [];
      if (Array.isArray(data.data)) {
        models = data.data.map(m => m.id || m.name || m.model).filter(Boolean);
      } else if (Array.isArray(data.models)) {
        models = data.models.map(m => typeof m === 'string' ? m : (m.id || m.name || m.model)).filter(Boolean);
      } else if (Array.isArray(data)) {
        models = data.map(m => typeof m === 'string' ? m : (m.id || m.name || m.model)).filter(Boolean);
      }

      models.sort((a, b) => a.localeCompare(b));
      fetchedModels = models;

      modelDatalist.innerHTML = '';
      models.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        modelDatalist.appendChild(option);
      });

      modelFetchStatus.textContent = '已获取 ' + models.length + ' 个模型';
      modelFetchStatus.className = 'fetch-status success';
    } catch (err) {
      if (err.name === 'AbortError') {
        modelFetchStatus.textContent = '获取模型列表超时';
      } else {
        modelFetchStatus.textContent = '获取失败：' + err.message;
      }
      modelFetchStatus.className = 'fetch-status error';
    } finally {
      fetchModelsBtn.disabled = false;
    }
  }

  function init() {
    if (!isLocalStorageAvailable()) {
      showToast('浏览器存储不可用，配置和历史记录将无法保存。请检查是否处于隐私模式。', 'warning');
    }
    endpointPathSelect.innerHTML = buildEndpointSelectOptions();
    renderEndpoint();
    renderHeaders();
    renderFormMode();
    renderHistory();
    renderConfigSelect();
    updateFinalUrl();
    bindEvents();
    restoreFromUrlParams();
  }

  function renderEndpoint() {
    baseUrlInput.value = currentConfig.baseUrl;
    endpointPathInput.value = currentConfig.endpointPath;
    httpMethodSelect.value = currentConfig.httpMethod;

    const presetOptions = Array.from(endpointPathSelect.options).map(o => o.value);
    if (presetOptions.includes(currentConfig.endpointPath)) {
      endpointPathSelect.value = currentConfig.endpointPath;
    } else {
      endpointPathSelect.value = 'custom';
    }
  }

  function updateFinalUrl() {
    const base = baseUrlInput.value.trim().replace(/\/+$/, '');
    const path = endpointPathInput.value.trim().replace(/^\/+/, '/');
    const url = base ? (base + path) : '';
    finalUrlSpan.textContent = url;
  }

  function renderHeaders() {
    headersContainer.innerHTML = '';
    const tmpl = document.getElementById('tmplHeaderRow');
    currentConfig.headers.forEach((h, idx) => {
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

  function renderFormMode() {
    formContainer.innerHTML = '';

    const endpointPath = currentConfig.endpointPath;
    const hasMessages = endpointHasMessages(endpointPath);
    const params = getEndpointParams(endpointPath);

    const tip = document.createElement('div');
    tip.style.fontSize = '0.8rem';
    tip.style.color = '#9ca3af';
    if (endpointPath === '/responses') {
      tip.innerHTML = 'Responses API 使用 input 字段代替 messages。如需编辑复杂 input 数组或工具调用，建议切换到 <strong>JSON 模式</strong>。';
    } else if (endpointPath === '/chat/completions') {
      tip.textContent = '当前表单以 Chat Completions messages 格式为主。';
    } else {
      tip.textContent = '当前端点：' + endpointPath + '，参数已根据端点类型自动调整。';
    }
    formContainer.appendChild(tip);

    if (hasMessages) {
      const messages = currentConfig.body?.messages || [];
      const msgDiv = document.createElement('div');
      msgDiv.innerHTML = '<h3>messages</h3>';
      const msgTmpl = document.getElementById('tmplMsgRow');
      messages.forEach((m, idx) => {
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
        contentTextarea.textContent = m.content || '';
        const delBtn = clone.querySelector('.danger');
        delBtn.dataset.msgIdx = idx;
        msgDiv.appendChild(clone);
      });

      const addMsgBtn = document.createElement('button');
      addMsgBtn.type = 'button';
      addMsgBtn.textContent = '+ 添加消息';
      addMsgBtn.addEventListener('click', () => {
        currentConfig.body.messages.push({ role: 'user', content: '' });
        renderFormMode();
        updateJsonPreview();
      });
      msgDiv.appendChild(addMsgBtn);

      formContainer.appendChild(msgDiv);
    }

    const paramsDiv = document.createElement('div');
    paramsDiv.innerHTML = '<h3>常用参数</h3>';

    if (params.length === 0) {
      const emptyTip = document.createElement('div');
      emptyTip.style.fontSize = '0.8rem';
      emptyTip.style.color = '#9ca3af';
      emptyTip.textContent = '当前端点无需请求体参数。';
      paramsDiv.appendChild(emptyTip);
    }

    params.forEach(p => {
      const value = currentConfig.body?.[p.name];
      const row = document.createElement('div');
      row.className = 'param-row';

      if (p.type === 'checkbox') {
        row.innerHTML =
          '<label for="param-' + p.name + '">' + p.name + '</label>' +
          '<input id="param-' + p.name + '" type="checkbox" data-param="' + p.name + '"' + (value ? ' checked' : '') + '>' +
          '<span class="param-desc" title="' + escapeHtml(p.description || '') + '">' + escapeHtml(p.description || '') + '</span>';
      } else if (p.type === 'select') {
        const optionsHtml = (p.options || []).map(opt => {
          const selected = value === opt ? ' selected' : '';
          return '<option value="' + escapeHtml(opt) + '"' + selected + '>' + escapeHtml(opt) + '</option>';
        }).join('');
        const val = value ?? p.default ?? '';
        const isCustom = val && !(p.options || []).includes(val);
        row.innerHTML =
          '<label for="param-' + p.name + '">' + p.name + '</label>' +
          '<select id="param-' + p.name + '" data-param="' + p.name + '" autocomplete="off">' +
          '<option value=""' + (!val ? ' selected' : '') + '>-- ' + escapeHtml(p.placeholder || '请选择') + ' --</option>' +
          optionsHtml +
          '<option value="__custom__"' + (isCustom ? ' selected' : '') + '>自定义...</option>' +
          '</select>' +
          '<input type="text" id="param-' + p.name + '-custom" data-param="' + p.name + '" value="' + (isCustom ? escapeHtml(String(val)) : '') + '" placeholder="输入自定义值..." style="display:' + (isCustom ? '' : 'none') + '; margin-top:0.25rem;" autocomplete="off" spellcheck="false">' +
          '<span class="param-desc" title="' + escapeHtml(p.description || '') + '">' + escapeHtml(p.description || '') + '</span>';
      } else {
        const inputType = p.type === 'number' ? 'number' : 'text';
        const val = value ?? p.default ?? '';
        const datalistAttr = p.datalist ? ' list="' + p.datalist + '"' : '';
        row.innerHTML =
          '<label for="param-' + p.name + '">' + p.name + '</label>' +
          '<input id="param-' + p.name + '" type="' + inputType + '" data-param="' + p.name + '" value="' + escapeHtml(String(val)) + '" ' +
          'min="' + (p.min ?? '') + '" max="' + (p.max ?? '') + '" step="' + (p.step ?? '') + '" placeholder="' + (p.placeholder || '') + '…" ' +
          'autocomplete="off" spellcheck="false"' + datalistAttr + '>' +
          '<span class="param-desc" title="' + escapeHtml(p.description || '') + '">' + escapeHtml(p.description || '') + '</span>';
      }
      paramsDiv.appendChild(row);
    });

    formContainer.appendChild(paramsDiv);

    const customDiv = document.createElement('div');
    customDiv.innerHTML = '<h3>自定义参数</h3>';

    const presetSelect = document.createElement('select');
    presetSelect.id = 'customParamPreset';
    presetSelect.innerHTML = PRESET_OPTIONS_HTML;
    presetSelect.addEventListener('change', (e) => {
      const idx = parseInt(e.target.value);
      if (isNaN(idx)) return;
      const preset = CUSTOM_PARAM_PRESETS[idx];
      const exists = currentConfig.customParams.some(p => p.key === preset.key);
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
    const presetRow = document.createElement('div');
    presetRow.className = 'param-row';
    presetRow.appendChild(presetSelect);
    customDiv.appendChild(presetRow);

    currentConfig.customParams.forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'param-row';
      const preset = CUSTOM_PARAM_PRESETS.find(cp => cp.key === p.key);
      const desc = preset ? preset.description : '';
      row.innerHTML =
        '<input type="text" value="' + escapeHtml(p.key) + '" data-custom-idx="' + idx + '" class="custom-key" placeholder="参数名…" aria-label="自定义参数名" spellcheck="false" autocomplete="off" title="' + escapeHtml(desc) + '">' +
        '<input type="text" value="' + escapeHtml(String(p.value)) + '" data-custom-idx="' + idx + '" class="custom-value" placeholder="参数值（JSON 字符串或普通文本）…" aria-label="自定义参数值" spellcheck="false" autocomplete="off" title="' + escapeHtml(desc) + '">' +
        '<button type="button" class="danger small" data-custom-idx="' + idx + '" aria-label="删除自定义参数">删除</button>';
      customDiv.appendChild(row);
    });
    formContainer.appendChild(customDiv);
  }

  function syncFormToConfig() {
    const roles = document.querySelectorAll('.msg-role');
    const contents = document.querySelectorAll('.msg-content');
    if (!currentConfig.body) currentConfig.body = {};
    currentConfig.body.messages = Array.from(roles).map((select, idx) => ({
      role: select.value,
      content: contents[idx].value || ''
    }));

    const currentParams = getEndpointParams(currentConfig.endpointPath);
    document.querySelectorAll('[data-param]').forEach(input => {
      const name = input.dataset.param;
      const param = currentParams.find(p => p.name === name);
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
        } else {
          value = selectVal;
        }
      } else {
        value = input.value;
        if (param.type === 'number') {
          if (input.value.trim() !== '') {
            value = parseFloat(input.value);
            if (isNaN(value)) value = param.default ?? 0;
            const validation = validateParamValue(name, value, param);
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

    currentConfig.customParams = Array.from(document.querySelectorAll('.custom-key')).map((input, idx) => {
      const key = input.value.trim();
      const valInput = document.querySelectorAll('.custom-value')[idx];
      let value = valInput.value.trim();
      if (!key) return null;

      try {
        value = JSON.parse(value);
      } catch (e) {
        // 保持字符串
      }
      return { key, value };
    }).filter(Boolean);
  }

  function fullConfigToJson() {
    syncFormToConfig();
    const body = deepClone(currentConfig.body);

    currentConfig.customParams.forEach(p => {
      body[p.key] = p.value;
    });

    const headers = {};
    currentConfig.headers.forEach(h => {
      if (h.key) headers[h.key] = h.value;
    });

    const fullConfig = {
      baseUrl: baseUrlInput.value.trim(),
      endpointPath: endpointPathInput.value.trim(),
      httpMethod: httpMethodSelect.value,
      headers,
      body
    };

    return JSON.stringify(fullConfig, null, 2);
  }

  function jsonToFullConfig(json) {
    try {
      const fullConfig = JSON.parse(json);

      if (fullConfig.baseUrl !== undefined) {
        baseUrlInput.value = fullConfig.baseUrl;
        currentConfig.baseUrl = fullConfig.baseUrl;
      }
      if (fullConfig.endpointPath !== undefined) {
        endpointPathInput.value = fullConfig.endpointPath;
        currentConfig.endpointPath = fullConfig.endpointPath;
      }
      if (fullConfig.httpMethod !== undefined) {
        httpMethodSelect.value = fullConfig.httpMethod;
        currentConfig.httpMethod = fullConfig.httpMethod;
      }

      if (fullConfig.headers && typeof fullConfig.headers === 'object') {
        currentConfig.headers = Object.entries(fullConfig.headers).map(([key, value]) => ({ key, value }));
        renderHeaders();
      }

      if (fullConfig.body && typeof fullConfig.body === 'object') {
        currentConfig.body = fullConfig.body;
        currentConfig.customParams = [];
      } else if (fullConfig.body === undefined && fullConfig.model !== undefined) {
        const { baseUrl, endpointPath, httpMethod, headers, ...body } = fullConfig;
        currentConfig.body = body;
        currentConfig.customParams = [];
      }

      renderEndpoint();
      renderFormMode();
      updateFinalUrl();
      jsonError.textContent = '';
      return true;
    } catch (e) {
      jsonError.textContent = 'JSON 解析错误：' + e.message + '，请检查括号、引号是否匹配';
      return false;
    }
  }

  const debouncedUpdateJsonPreview = debounce(updateJsonPreview, 300);

  function updateJsonPreview() {
    if (!currentConfig.jsonMode) return;
    requestJson.value = fullConfigToJson();
  }

  function syncJsonToForm() {
    const json = requestJson.value;
    if (jsonToFullConfig(json)) {
      currentConfig.jsonMode = false;
      formModeSections.forEach(s => s.style.display = '');
      jsonMode.style.display = 'none';
      setActiveTab(document.querySelector('[data-mode="form"]'), document.querySelector('.mode-switch .tab-bar'));
    }
  }

  function switchMode(mode) {
    currentConfig.jsonMode = mode === 'json';
    formModeSections.forEach(s => s.style.display = currentConfig.jsonMode ? 'none' : '');
    jsonMode.style.display = currentConfig.jsonMode ? '' : 'none';
    if (currentConfig.jsonMode) {
      updateJsonPreview();
    }
  }

  function setActiveTab(tab, bar) {
    if (!tab || !bar) return;
    bar.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  }

  function buildRequestParams() {
    syncFormToConfig();

    const base = baseUrlInput.value.trim().replace(/\/+$/, '');
    const path = endpointPathInput.value.trim().replace(/^\/+/, '/');
    const url = base + path;

    const headers = {};
    currentConfig.headers.forEach(h => {
      if (h.key) headers[h.key] = h.value;
    });

    let body;
    if (currentConfig.jsonMode) {
      try {
        const fullConfig = JSON.parse(requestJson.value);
        body = fullConfig.body ? JSON.stringify(fullConfig.body, null, 2) : '{}';
      } catch (e) {
        body = requestJson.value;
      }
    } else {
      body = fullConfigToJson();
      try {
        const fullConfig = JSON.parse(body);
        body = JSON.stringify(fullConfig.body, null, 2);
      } catch (e) {
        // 保持原样
      }
    }

    return {
      url,
      method: httpMethodSelect.value,
      headers,
      body: (httpMethodSelect.value === 'POST' || httpMethodSelect.value === 'PUT' || httpMethodSelect.value === 'PATCH') ? body : undefined
    };
  }

  function showToast(message, type) {
    type = type || 'info';
    const container = $('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  function sanitizeHeadersForStorage(headers) {
    const sanitized = {};
    Object.entries(headers).forEach(([key, val]) => {
      if (isSensitiveHeader(key)) {
        const spaceIdx = val.indexOf(' ');
        sanitized[key] = spaceIdx > 0 ? val.substring(0, spaceIdx) + ' ***' : '***';
      } else {
        sanitized[key] = val;
      }
    });
    return sanitized;
  }

  function revokeContainerBlobUrls() {
    responseContainer.querySelectorAll('img[src^="blob:"], audio[src^="blob:"], video[src^="blob:"]').forEach(el => {
      URL.revokeObjectURL(el.src);
    });
  }

 async function sendRequest(retryCount) {
    retryCount = retryCount || 0;
    const params = buildRequestParams();
    if (!params.url) {
      showToast('请先填写 Base URL 和端点路径', 'error');
      return;
    }

    let isStreaming = false;
    try {
      const bodyObj = JSON.parse(params.body || '{}');
      isStreaming = bodyObj.stream === true;
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
    revokeContainerBlobUrls();
    responseContainer.innerHTML = '';
    httpStatusSpan.textContent = '-';
    durationSpan.textContent = '-';

    if (retryCount > 0) {
      sendBtn.innerHTML = '<span class="spinner"></span>重试中 (' + retryCount + '/' + MAX_RETRIES + ')…';
    } else {
      sendBtn.innerHTML = '<span class="spinner"></span>请求中…';
    }

    const timeoutId = setTimeout(() => {
      if (abortController) {
        abortController.abort();
        showToast('请求超时（' + (REQUEST_TIMEOUT_MS / 1000) + ' 秒），请检查网络或 API 服务状态', 'error');
      }
    }, REQUEST_TIMEOUT_MS);

    const requestHeaders = Object.assign({}, params.headers);
    if (ENABLE_IDEMPOTENCY_KEY && (params.method === 'POST' || params.method === 'PUT' || params.method === 'PATCH') && retryCount === 0) {
      requestHeaders['Idempotency-Key'] = generateIdempotencyKey();
    }

    const options = {
      method: params.method,
      headers: requestHeaders,
      body: params.body,
      signal: abortController.signal
    };

    try {
      const response = await fetch(params.url, options);
      clearTimeout(timeoutId);
      const httpStatus = response.status;
      httpStatusSpan.textContent = httpStatus;

      if (httpStatus === 429 && retryCount < MAX_RETRIES) {
        const retryAfter = response.headers.get('retry-after');
        let delay;
        if (retryAfter) {
          const retrySeconds = parseInt(retryAfter, 10);
          if (!isNaN(retrySeconds)) {
            delay = retrySeconds * 1000;
          } else {
            const retryDate = new Date(retryAfter);
            delay = Math.max(0, retryDate.getTime() - Date.now());
          }
        } else {
          delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
        }
        showToast('遇到速率限制 (429)，' + Math.round(delay / 1000) + ' 秒后重试…', 'warning');
        sendBtn.innerHTML = '<span class="spinner"></span>等待重试 (' + Math.round(delay / 1000) + 's)…';
        await new Promise(r => setTimeout(r, delay));
        return sendRequest(retryCount + 1);
      }
      if ((httpStatus === 502 || httpStatus === 503 || httpStatus === 504) && retryCount < MAX_RETRIES) {
        const delay = 1000 + Math.random() * 1000;
        showToast('服务器暂时不可用 (' + httpStatus + ')，' + Math.round(delay / 1000) + ' 秒后重试…', 'warning');
        await new Promise(r => setTimeout(r, delay));
        return sendRequest(retryCount + 1);
      }

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const isSse = contentType.includes('text/event-stream') || isStreaming;

      if (isSse && response.body) {
        await handleSseResponse(response);
        const duration = Date.now() - requestStartTime;
        durationSpan.textContent = duration + ' ms';
        addHistory(params, httpStatus, duration);
        sendBtn.disabled = false;
        sendBtn.textContent = '发送请求';
        abortBtn.disabled = true;
        abortController = null;
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

      addHistory(params, httpStatus, duration);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        if (retryCount === 0) {
          showToast('请求已中止', 'info');
        }
      } else if (err.name === 'TypeError') {
        if (err.message.includes('fetch')) {
          showToast('网络请求失败：无法连接到服务器。如为 CORS 错误，可尝试使用浏览器扩展（如 CORS Unblock）或通过后端代理转发请求', 'error');
        } else if (err.message.includes('CORS')) {
          showToast('CORS 错误：服务器未允许跨域请求。建议使用浏览器 CORS 扩展或通过后端代理转发请求', 'error');
        } else {
          showToast('请求失败：' + err.message, 'error');
        }
      } else {
        showToast('请求失败：' + err.message, 'error');
      }

      if (err.name !== 'AbortError' && retryCount < MAX_RETRIES) {
        const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
        showToast('网络错误，' + Math.round(delay / 1000) + ' 秒后重试…', 'warning');
        sendBtn.innerHTML = '<span class="spinner"></span>等待重试 (' + Math.round(delay / 1000) + 's)…';
        await new Promise(r => setTimeout(r, delay));
        return sendRequest(retryCount + 1);
      }
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = '发送请求';
      abortBtn.disabled = true;
      abortController = null;
    }
  }

  async function handleSseResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullContent = '';
    let fullEvents = [];
    let sseRetryInterval = null;
    let lastEventId = null;
    currentResponseType = 'stream';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent = null;
      let currentData = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line === '') {
          if (currentData) {
            const data = currentData;
            currentData = '';
            if (data === '[DONE]') {
              currentEvent = null;
              continue;
            }
            try {
              const event = JSON.parse(data);
              if (lastEventId) event._lastEventId = lastEventId;
              fullEvents.push(event);

              let deltaText = '';
              if (event.choices && event.choices[0]?.delta) {
                deltaText = event.choices[0].delta.content || '';
                const reasoning = event.choices[0].delta.reasoning_content;
                if (reasoning) {
                  deltaText = '[思考] ' + reasoning + '\n' + deltaText;
                }
              } else if (event.output && event.output[0]?.content?.[0]?.text) {
                deltaText = event.output[0].content[0].text;
              }
              fullContent += deltaText;
              renderStreamingText(fullContent);
            } catch (e) {
              // 忽略解析错误
            }
          }
          currentEvent = null;
          continue;
        }

        if (line.startsWith('event:')) {
          currentEvent = line.substring(6).trim();
        } else if (line.startsWith('id:')) {
          lastEventId = line.substring(3).trim();
        } else if (line.startsWith('retry:')) {
          const retryMs = parseInt(line.substring(6).trim(), 10);
          if (!isNaN(retryMs) && retryMs > 0) {
            sseRetryInterval = retryMs;
          }
        } else if (line.startsWith('data:')) {
          currentData += line.substring(5).trim();
        } else if (line.startsWith(':')) {
          // SSE 注释，忽略
        }
      }
    }

    if (buffer.trim()) {
      const remaining = buffer.trim();
      if (remaining.startsWith('data:')) {
        const data = remaining.replace(/^data:\s*/, '');
        if (data !== '[DONE]') {
          try {
            const event = JSON.parse(data);
            fullEvents.push(event);
            let deltaText = '';
            if (event.choices && event.choices[0]?.delta) {
              deltaText = event.choices[0].delta.content || '';
            } else if (event.output && event.output[0]?.content?.[0]?.text) {
              deltaText = event.output[0].content[0].text;
            }
            fullContent += deltaText;
          } catch (e) {
            // 忽略
          }
        }
      }
    }

    currentResponseData = fullEvents;
    currentRawResponseText = fullEvents.map(e => JSON.stringify(e)).join('\n');
    renderTextResponse(fullContent, 'text/plain');
  }

  function renderStreamingText(text) {
    responseContainer.innerHTML = '';
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = text;
    responseContainer.appendChild(pre);
  }

  function renderResponse(data) {
    responseContainer.innerHTML = '';
    const json = JSON.stringify(data, null, 2);
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = json;
    responseContainer.appendChild(pre);
  }

  function renderTextResponse(text, contentType) {
    responseContainer.innerHTML = '';
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = text;
    responseContainer.appendChild(pre);
  }

  function renderBlobResponse(blob, contentType) {
    responseContainer.innerHTML = '';
    const url = URL.createObjectURL(blob);

    if (contentType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'API 响应图片';
      responseContainer.appendChild(img);
    } else if (contentType.startsWith('audio/')) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = url;
      responseContainer.appendChild(audio);
    } else if (contentType.startsWith('video/')) {
      const video = document.createElement('video');
      video.controls = true;
      video.src = url;
      responseContainer.appendChild(video);
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'response';
      a.textContent = '下载响应文件';
      responseContainer.appendChild(a);
    }
  }

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
    history.unshift(item);
    if (history.length > 20) history = history.slice(0, 20);
    saveHistory(history);
    renderHistory();
  }

  function renderHistory() {
    historyList.innerHTML = '';
    if (history.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = '暂无历史记录，发送请求后会自动保存';
      empty.style.cursor = 'default';
      historyList.appendChild(empty);
      return;
    }
    const dtFormat = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const tmpl = document.getElementById('tmplHistoryItem');
    history.forEach(item => {
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

  function loadHistoryToConfig(id) {
    const item = history.find(h => h.id === id);
    if (!item) return;

    let baseUrl, endpointPath;
    try {
      const url = new URL(item.url);
      const knownEndpoints = Object.keys(ENDPOINT_TEMPLATES);
      let matchedEndpoint = knownEndpoints.find(ep => url.pathname.endsWith(ep));
      if (matchedEndpoint) {
        endpointPath = matchedEndpoint;
        baseUrl = item.url.substring(0, item.url.lastIndexOf(matchedEndpoint));
      } else {
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length >= 2) {
          endpointPath = '/' + pathParts.slice(-2).join('/');
          baseUrl = url.origin + '/' + pathParts.slice(0, -2).join('/');
          if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        } else {
          endpointPath = url.pathname || '/';
          baseUrl = url.origin;
        }
      }
    } catch (e) {
      baseUrl = item.url;
      endpointPath = '/';
    }

    baseUrlInput.value = baseUrl;
    endpointPathInput.value = endpointPath;
    httpMethodSelect.value = item.method;

    currentConfig.headers = Object.entries(item.headers).map(([key, value]) => ({ key, value }));
    renderHeaders();

    try {
      const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
      currentConfig.body = body;
      currentConfig.customParams = [];
      currentConfig.jsonMode = false;
      formModeSections.forEach(s => s.style.display = '');
      jsonMode.style.display = 'none';
      renderFormMode();
      requestJson.value = fullConfigToJson();
    } catch (e) {
      showToast('历史配置加载失败：' + e.message + '，请尝试手动填写参数', 'error');
    }

    updateFinalUrl();
    fetchModels();
  }

  function restoreFromUrlParams() {
    const params = new URLSearchParams(location.search);
    const config = params.get('config');
    if (!config) return;
    try {
      const decoded = JSON.parse(decodeURIComponent(config));
      if (decoded.baseUrl) baseUrlInput.value = decoded.baseUrl;
      if (decoded.endpointPath) endpointPathInput.value = decoded.endpointPath;
      if (decoded.httpMethod) httpMethodSelect.value = decoded.httpMethod;
      if (decoded.headers) {
        const safeHeaders = Object.entries(decoded.headers)
          .filter(([key]) => !isSensitiveHeader(key))
          .map(([key, value]) => ({ key, value }));
        currentConfig.headers = safeHeaders;
        const removedCount = Object.keys(decoded.headers).length - safeHeaders.length;
        if (removedCount > 0) {
          showToast('出于安全考虑，URL 中的 ' + removedCount + ' 个敏感请求头（如 Authorization）已被移除，请手动填写', 'warning');
        }
      }
      if (decoded.body) {
        currentConfig.body = decoded.body;
        currentConfig.customParams = decoded.customParams || [];
        currentConfig.jsonMode = false;
        renderFormMode();
        requestJson.value = fullConfigToJson();
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
      endpointPath: endpointPathInput.value.trim(),
      httpMethod: httpMethodSelect.value,
      headers: {},
      body: deepClone(currentConfig.body)
    };
    currentConfig.headers.forEach(h => {
      if (h.key && !isSensitiveHeader(h.key)) {
        config.headers[h.key] = h.value;
      }
    });
    currentConfig.customParams.forEach(p => {
      config.body[p.key] = p.value;
    });
    return location.origin + location.pathname + '?config=' + encodeURIComponent(JSON.stringify(config));
  }

  function bindEvents() {
    baseUrlInput.addEventListener('input', updateFinalUrl);

    let fetchModelsTimer = null;
    baseUrlInput.addEventListener('input', () => {
      clearTimeout(fetchModelsTimer);
      const base = baseUrlInput.value.trim();
      if (!base) return;
      fetchModelsTimer = setTimeout(fetchModels, 1500);
    });

    fetchModelsBtn.addEventListener('click', fetchModels);

    endpointPathInput.addEventListener('input', () => {
      const presetOptions = Array.from(endpointPathSelect.options).map(o => o.value);
      if (presetOptions.includes(endpointPathInput.value)) {
        endpointPathSelect.value = endpointPathInput.value;
      } else {
        endpointPathSelect.value = 'custom';
      }
      updateFinalUrl();
    });
    endpointPathSelect.addEventListener('change', () => {
      const val = endpointPathSelect.value;
      const prevEndpoint = currentConfig.endpointPath;
      if (val && val !== 'custom') {
        endpointPathInput.value = val;
      }
      if (val === '/models') {
        httpMethodSelect.value = 'GET';
      } else if (val && val !== 'custom' && val !== '') {
        httpMethodSelect.value = 'POST';
      }
      if (val && val !== 'custom' && val !== '' && val !== prevEndpoint) {
        currentConfig.endpointPath = val;
        currentConfig.body = getEndpointDefaultBody(val);
        currentConfig.customParams = [];
        renderFormMode();
        updateJsonPreview();
      }
      updateFinalUrl();
    });
    httpMethodSelect.addEventListener('change', updateFinalUrl);

    addHeaderBtn.addEventListener('click', () => {
      currentConfig.headers.push({ key: '', value: '' });
      renderHeaders();
    });

    headersContainer.addEventListener('click', e => {
      if (e.target.matches('.danger')) {
        const idx = +e.target.dataset.idx;
        currentConfig.headers.splice(idx, 1);
        renderHeaders();
      }
    });

    headersContainer.addEventListener('input', e => {
      const idx = +e.target.dataset.idx;
      if (e.target.matches('.header-key')) {
        currentConfig.headers[idx].key = e.target.value;
      } else if (e.target.matches('.header-value')) {
        currentConfig.headers[idx].value = e.target.value;
      }
    });

    const modeSwitchBar = document.querySelector('.mode-switch .tab-bar');
    if (modeSwitchBar) {
      modeSwitchBar.addEventListener('click', e => {
        if (e.target.matches('.tab')) {
          const mode = e.target.dataset.mode;
          if (mode) switchMode(mode);
          setActiveTab(e.target, modeSwitchBar);
        }
      });
    }

    const responseBar = document.querySelector('.response-card .tab-bar');
    if (responseBar) {
      responseBar.addEventListener('click', e => {
        if (e.target.matches('.tab')) {
          const view = e.target.dataset.view;
          if (view) switchView(view);
          setActiveTab(e.target, responseBar);
        }
      });
    }

    formContainer.addEventListener('input', debouncedUpdateJsonPreview);
    formContainer.addEventListener('change', (e) => {
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

    addParamBtn.addEventListener('click', () => {
      currentConfig.customParams.push({ key: '', value: '' });
      renderFormMode();
      updateJsonPreview();
    });

    formContainer.addEventListener('click', e => {
      if (e.target.matches('.danger')) {
        const idx = +e.target.dataset.idx ?? e.target.dataset.customIdx ?? e.target.dataset.msgIdx;
        if (e.target.dataset.customIdx !== undefined) {
          currentConfig.customParams.splice(idx, 1);
        } else if (e.target.dataset.msgIdx !== undefined) {
          currentConfig.body.messages.splice(idx, 1);
        }
        renderFormMode();
        updateJsonPreview();
      }
    });

    formatJsonBtn.addEventListener('click', () => {
      try {
        const obj = JSON.parse(requestJson.value);
        requestJson.value = JSON.stringify(obj, null, 2);
        jsonError.textContent = '';
      } catch (e) {
        jsonError.textContent = '格式化失败：' + e.message + '，请检查 JSON 语法是否正确';
      }
    });

    parseJsonBtn.addEventListener('click', () => {
      syncJsonToForm();
    });

    let jsonParseDebounceTimer = null;
    requestJson.addEventListener('input', () => {
      clearTimeout(jsonParseDebounceTimer);
      jsonParseDebounceTimer = setTimeout(() => {
        try {
          JSON.parse(requestJson.value);
          jsonError.textContent = '';
        } catch (e) {
          jsonError.textContent = 'JSON 语法错误：' + e.message;
        }
      }, 500);
    });

    sendBtn.addEventListener('click', sendRequest);
    abortBtn.addEventListener('click', () => {
      if (abortController) abortController.abort();
    });

    historyList.addEventListener('click', e => {
      const li = e.target.closest('li');
      if (!li) return;
      const id = +li.dataset.id;
      loadHistoryToConfig(id);
    });

    historyList.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const li = e.target.closest('li');
        if (!li) return;
        const id = +li.dataset.id;
        loadHistoryToConfig(id);
      }
    });

    baseUrlInput.addEventListener('input', debouncedUpdateJsonPreview);
    endpointPathInput.addEventListener('input', debouncedUpdateJsonPreview);
    endpointPathSelect.addEventListener('change', updateJsonPreview);
    httpMethodSelect.addEventListener('change', updateJsonPreview);

    headersContainer.addEventListener('input', debouncedUpdateJsonPreview);
    headersContainer.addEventListener('click', () => {
      setTimeout(updateJsonPreview, 0);
    });
    addHeaderBtn.addEventListener('click', () => {
      setTimeout(updateJsonPreview, 0);
    });

    clearHistoryBtn.addEventListener('click', () => {
      showConfirm('确定要清空所有历史记录吗？此操作不可撤销。', () => {
        history = [];
        saveHistory(history);
        renderHistory();
      });
    });

    exportHistoryBtn.addEventListener('click', () => {
      const safeHistory = history.map(item => {
        const safeItem = Object.assign({}, item);
        if (safeItem.headers) {
          const safeHeaders = {};
          Object.entries(safeItem.headers).forEach(([key, val]) => {
            if (!isSensitiveHeader(key)) {
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
      const a = document.createElement('a');
      a.href = url;
      a.download = 'openai_debugger_history.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    function switchView(view) {
      if (!currentResponseData && !currentRawResponseText) return;

      if (view === 'raw') {
        responseContainer.innerHTML = '';
        const pre = document.createElement('pre');
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordBreak = 'break-all';
        if (currentResponseType === 'json' && currentResponseData) {
          pre.textContent = JSON.stringify(currentResponseData, null, 2);
        } else if (currentResponseType === 'blob') {
          pre.textContent = '[二进制数据] ' + (currentResponseData?.type || 'unknown') + '，大小: ' + (currentResponseData?.size || '?') + ' bytes';
        } else if (currentResponseType === 'stream' && currentRawResponseText) {
          pre.textContent = currentRawResponseText;
        } else {
          pre.textContent = currentRawResponseText || String(currentResponseData);
        }
        responseContainer.appendChild(pre);
      } else {
        if (currentResponseType === 'json' && currentResponseData) {
          renderResponse(currentResponseData);
        } else if (currentResponseType === 'blob' && currentResponseData) {
          renderBlobResponse(currentResponseData, currentResponseData.type || 'application/octet-stream');
        } else if (currentResponseType === 'stream' && currentResponseData) {
          let fullContent = '';
          for (const event of currentResponseData) {
            let deltaText = '';
            if (event.choices && event.choices[0]?.delta) {
              deltaText = event.choices[0].delta.content || '';
              const reasoning = event.choices[0].delta.reasoning_content;
              if (reasoning) {
                deltaText = '[思考] ' + reasoning + '\n' + deltaText;
              }
            } else if (event.output && event.output[0]?.content?.[0]?.text) {
              deltaText = event.output[0].content[0].text;
            }
            fullContent += deltaText;
          }
          renderTextResponse(fullContent, 'text/plain');
        } else {
          renderTextResponse(currentRawResponseText || '', 'text/plain');
        }
      }
    }

    shareUrlBtn.addEventListener('click', () => {
      syncFormToConfig();
      const url = buildShareUrl();
      showConfirm('分享链接会将 Base URL、端点路径和请求参数（含 messages 内容）编码到 URL 中，该内容可能被浏览器历史、服务器日志等记录。确定要复制分享链接吗？', () => {
        navigator.clipboard.writeText(url).then(() => {
          showToast('分享链接已复制到剪贴板', 'success');
        }).catch(() => {
          prompt('复制链接（请手动复制）：', url);
        });
      });
    });

    saveConfigBtn.addEventListener('click', () => {
      const name = configNameInput.value.trim();
      if (!name) {
        showToast('请输入配置名称', 'error');
        return;
      }
      syncFormToConfig();
      const configData = {
        baseUrl: baseUrlInput.value.trim(),
        endpointPath: endpointPathInput.value.trim(),
        httpMethod: httpMethodSelect.value,
        headers: currentConfig.headers.map(h => ({ ...h })),
        body: deepClone(currentConfig.body),
        customParams: deepClone(currentConfig.customParams)
      };
      const action = saveConfig(name, configData);
      renderConfigSelect();
      configNameInput.value = '';
      showToast('配置「' + name + '」已' + action, 'success');
    });

    loadConfigBtn.addEventListener('click', () => {
      const name = configSelect.value;
      if (!name) {
        showToast('请选择一个配置', 'error');
        return;
      }
      const saved = getConfigByName(name);
      if (!saved) {
        showToast('配置不存在', 'error');
        return;
      }
      loadSavedConfig(saved);
    });

    deleteConfigBtn.addEventListener('click', () => {
      const name = configSelect.value;
      if (!name) {
        showToast('请选择一个配置', 'error');
        return;
      }
      showConfirm('确定要删除配置「' + name + '」吗？', () => {
        deleteConfig(name);
        renderConfigSelect();
        configSelect.value = '';
        showToast('配置「' + name + '」已删除', 'info');
      });
    });

    exportConfigBtn.addEventListener('click', () => {
      syncFormToConfig();
      const configData = {
        baseUrl: baseUrlInput.value.trim(),
        endpointPath: endpointPathInput.value.trim(),
        httpMethod: httpMethodSelect.value,
        headers: currentConfig.headers.map(h => {
          if (isSensitiveHeader(h.key)) {
            return { key: h.key, value: h.value.replace(/./g, '*').substring(0, 8) + '…' };
          }
          return { ...h };
        }),
        body: deepClone(currentConfig.body),
        customParams: deepClone(currentConfig.customParams)
      };
      const blob = new Blob([JSON.stringify(configData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'openai_config_' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('配置已导出（敏感请求头已脱敏）', 'success');
    });

    importConfigBtn.addEventListener('click', () => {
      importConfigFile.click();
    });

    importConfigFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
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

  function loadSavedConfig(saved) {
    if (saved.baseUrl !== undefined) {
      baseUrlInput.value = saved.baseUrl;
      currentConfig.baseUrl = saved.baseUrl;
    }
    if (saved.endpointPath !== undefined) {
      endpointPathInput.value = saved.endpointPath;
      currentConfig.endpointPath = saved.endpointPath;
    }
    if (saved.httpMethod !== undefined) {
      httpMethodSelect.value = saved.httpMethod;
      currentConfig.httpMethod = saved.httpMethod;
    }
    if (saved.headers && Array.isArray(saved.headers)) {
      currentConfig.headers = saved.headers.map(h => ({ ...h }));
      renderHeaders();
    }
    if (saved.body && typeof saved.body === 'object') {
      currentConfig.body = deepClone(saved.body);
    }
    if (saved.customParams && Array.isArray(saved.customParams)) {
      currentConfig.customParams = deepClone(saved.customParams);
    }

    currentConfig.jsonMode = false;
    formModeSections.forEach(s => s.style.display = '');
    jsonMode.style.display = 'none';

    renderEndpoint();
    renderFormMode();
    updateFinalUrl();
    requestJson.value = fullConfigToJson();
    showToast('配置已加载', 'success');

    if (saved.baseUrl) fetchModels();
  }

  function renderConfigSelect() {
    const configs = loadSavedConfigs();
    configSelect.innerHTML = '<option value="">-- 选择已保存的配置 --</option>';
    configs.forEach(cfg => {
      const option = document.createElement('option');
      option.value = cfg.name;
      option.textContent = cfg.name;
      configSelect.appendChild(option);
    });
  }

  function showConfirm(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'confirm-title');
    overlay.innerHTML =
      '<div class="confirm-dialog">' +
      '<h3 id="confirm-title" class="confirm-title">确认操作</h3>' +
      '<p>' + escapeHtml(message) + '</p>' +
      '<div class="confirm-actions">' +
      '<button type="button" class="confirm-cancel">取消</button>' +
      '<button type="button" class="danger confirm-ok">确认</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('.confirm-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.confirm-ok').addEventListener('click', () => {
      overlay.remove();
      onConfirm();
    });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') overlay.remove();
    });
    overlay.querySelector('.confirm-ok').focus();
  }

  init();
})();
