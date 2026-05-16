// app.js – 主逻辑
;(function () {
  'use strict';

  var C = window.AppConfig;

  function escapeHtml(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  var REQUEST_TIMEOUT_MS = 60000;
  var MAX_RETRIES = 3;

  var currentConfig = C.createDefaultConfig();
  var history = C.loadHistory();

  var _syncSource = null;

  var abortController = null;
  var requestStartTime = null;
  var streamingResponse = '';
  var currentResponseData = null;
  var currentResponseType = 'json';
  var currentRawResponseText = '';
  var fetchedModels = [];

  var $ = function (id) { return document.getElementById(id); };

  var baseUrlInput = $('baseUrl');
  var endpointPathInput = $('endpointPath');
  var endpointPathSelect = $('endpointPathSelect');
  var httpMethodSelect = $('httpMethod');
  var finalUrlSpan = $('finalUrl');
  var headersContainer = $('headersContainer');
  var addHeaderBtn = $('addHeaderBtn');

  var formContainer = $('formContainer');
  var addParamBtn = $('addParamBtn');
  var requestJson = $('requestJson');
  var formatJsonBtn = $('formatJsonBtn');
  var parseJsonBtn = $('parseJsonBtn');
  var jsonError = $('jsonError');

  var sendBtn = $('sendBtn');
  var abortBtn = $('abortBtn');
  var requestTimeSpan = $('requestTime');

  var responseContainer = $('responseContainer');
  var httpStatusSpan = $('httpStatus');
  var durationSpan = $('duration');

  var historyList = $('historyList');
  var clearHistoryBtn = $('clearHistoryBtn');
  var exportHistoryBtn = $('exportHistoryBtn');

  var configSelect = $('configSelect');
  var loadConfigBtn = $('loadConfigBtn');
  var deleteConfigBtn = $('deleteConfigBtn');
  var configNameInput = $('configNameInput');
  var saveConfigBtn = $('saveConfigBtn');
  var exportConfigBtn = $('exportConfigBtn');
  var importConfigBtn = $('importConfigBtn');
  var importConfigFile = $('importConfigFile');

  var fetchModelsBtn = $('fetchModelsBtn');
  var modelFetchStatus = $('modelFetchStatus');
  var modelDatalist = $('modelDatalist');
  var shareUrlBtn = $('shareUrlBtn');

  var sidebarItems = document.querySelectorAll('.sidebar-item');
  var panelOverlay = $('panelOverlay');
  var savedConfigsPanel = $('savedConfigsPanel');
  var historyPanel = $('historyPanel');
  var configExpandBtn = $('configExpandBtn');
  var configSubmenu = $('configSubmenu');
  var configSubmenuList = $('configSubmenuList');
  var quickConfigName = $('quickConfigName');
  var quickSaveConfigBtn = $('quickSaveConfigBtn');

  var PRESET_OPTIONS_HTML = '<option value="">-- 添加常用自定义参数 --</option>' +
    C.CUSTOM_PARAM_PRESETS.map(function (preset, idx) {
      return '<option value="' + idx + '">' + escapeHtml(preset.key) + ' - ' + escapeHtml(preset.description) + '</option>';
    }).join('');

  function generateIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
  }

  function safeDomOp(fn) {
    try {
      return fn();
    } catch (e) {
      console.warn('DOM 操作失败：', e.message);
      return null;
    }
  }

  function isEndpointCustomMode() {
    var combo = document.querySelector('.endpoint-path-combo');
    return combo && combo.classList.contains('custom-mode');
  }

  function getEndpointPathValue() {
    return isEndpointCustomMode() ? endpointPathInput.value.trim() : endpointPathSelect.value.trim();
  }

  async function fetchModels() {
    var base = baseUrlInput.value.trim().replace(/\/+$/, '');
    if (!base) {
      modelFetchStatus.textContent = '';
      modelFetchStatus.className = 'fetch-status';
      return;
    }

    var url = base + '/models';

    var headers = {};
    currentConfig.headers.forEach(function (h) {
      if (h.key) headers[h.key] = h.value;
    });

    modelFetchStatus.textContent = '正在获取模型列表…';
    modelFetchStatus.className = 'fetch-status loading';
    fetchModelsBtn.disabled = true;

    try {
      var controller = new AbortController();
      var timeoutId = setTimeout(function () { controller.abort(); }, C.FETCH_MODELS_TIMEOUT_MS);

      var response = await fetch(url, {
        method: 'GET',
        headers: headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' ' + response.statusText);
      }

      var data = await response.json();

      var models = [];
      if (Array.isArray(data.data)) {
        models = data.data.map(function (m) { return m.id || m.name || m.model; }).filter(Boolean);
      } else if (Array.isArray(data.models)) {
        models = data.models.map(function (m) { return typeof m === 'string' ? m : (m.id || m.name || m.model); }).filter(Boolean);
      } else if (Array.isArray(data)) {
        models = data.map(function (m) { return typeof m === 'string' ? m : (m.id || m.name || m.model); }).filter(Boolean);
      }

      models.sort(function (a, b) { return a.localeCompare(b); });
      fetchedModels = models;

      modelDatalist.innerHTML = '';
      models.forEach(function (id) {
        var option = document.createElement('option');
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

  function checkPlaceholderApiKey() {
    var warnings = [];
    currentConfig.headers.forEach(function (h) {
      if (C.isSensitiveHeader(h.key) && C.isPlaceholderApiKey(h.value)) {
        warnings.push(h.key);
      }
    });
    return warnings;
  }

  function init() {
    if (!C.isLocalStorageAvailable()) {
      showToast('浏览器存储不可用，配置和历史记录将无法保存。请检查是否处于隐私模式。', 'warning');
    }
    endpointPathSelect.innerHTML = C.buildEndpointSelectOptions();
    renderEndpoint();
    renderHeaders();
    renderFormMode();
    renderHistory();
    renderConfigSelect();
    updateFinalUrl();
    updateJsonPreview();
    bindEvents();
    restoreFromUrlParams();
  }

  function renderEndpoint() {
    baseUrlInput.value = currentConfig.baseUrl;
    httpMethodSelect.value = currentConfig.httpMethod;

    var combo = document.querySelector('.endpoint-path-combo');
    var presetOptions = Array.from(endpointPathSelect.options).map(function (o) { return o.value; });
    if (presetOptions.includes(currentConfig.endpointPath) && currentConfig.endpointPath !== 'custom') {
      if (combo) combo.classList.remove('custom-mode');
      endpointPathSelect.value = currentConfig.endpointPath;
      endpointPathInput.value = currentConfig.endpointPath;
    } else {
      if (combo) combo.classList.add('custom-mode');
      endpointPathSelect.value = 'custom';
      endpointPathInput.value = currentConfig.endpointPath;
    }
  }

  function updateFinalUrl() {
    var base = baseUrlInput.value.trim().replace(/\/+$/, '');
    var rawPath = getEndpointPathValue();
    var path = rawPath.replace(/^\/+/, '/');
    if (path === 'custom') path = '';
    var url = base ? (base + (path ? '/' + path : '')) : '';
    finalUrlSpan.textContent = url;
  }

  function renderHeaders() {
    headersContainer.innerHTML = '';
    var tmpl = document.getElementById('tmplHeaderRow');
    currentConfig.headers.forEach(function (h, idx) {
      var clone = tmpl.content.cloneNode(true);
      var keyInput = clone.querySelector('.header-key');
      var valueInput = clone.querySelector('.header-value');
      var delBtn = clone.querySelector('.danger');
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

    var endpointPath = currentConfig.endpointPath;
    var hasMessages = C.endpointHasMessages(endpointPath);
    var params = C.getEndpointParams(endpointPath);

    var tip = document.createElement('div');
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

    if (params.length > 0) {
      var paramsDiv = document.createElement('div');
      params.forEach(function (p) {
        var value = currentConfig.body && currentConfig.body[p.name];
        var row = document.createElement('div');
        row.className = 'param-row';

        if (p.type === 'checkbox') {
          row.innerHTML =
            '<label for="param-' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</label>' +
            '<input id="param-' + escapeHtml(p.name) + '" type="checkbox" data-param="' + escapeHtml(p.name) + '"' + (value ? ' checked' : '') + '>' +
            '<span class="param-desc" title="' + escapeHtml(p.description || '') + '">' + escapeHtml(p.description || '') + '</span>';
        } else if (p.type === 'select') {
          var isBoolSelect = (p.options || []).every(function (opt) { return typeof opt === 'boolean'; });
          var optionsHtml = (p.options || []).map(function (opt) {
            var selected = value === opt ? ' selected' : '';
            var displayText = isBoolSelect ? (opt ? '是' : '否') : String(opt);
            return '<option value="' + escapeHtml(String(opt)) + '"' + selected + '>' + escapeHtml(displayText) + '</option>';
          }).join('');
          var val = value != null ? value : p.default;
          val = val != null ? val : '';
          var isCustom = !isBoolSelect && val !== '' && !(p.options || []).includes(val);
          var selectHtml =
            '<select id="param-' + escapeHtml(p.name) + '" data-param="' + escapeHtml(p.name) + '" autocomplete="off">';
          if (!isBoolSelect) {
            selectHtml += '<option value=""' + (!val && val !== false ? ' selected' : '') + '>-- ' + escapeHtml(p.placeholder || '请选择') + ' --</option>';
          }
          selectHtml += optionsHtml;
          if (!isBoolSelect) {
            selectHtml += '<option value="__custom__"' + (isCustom ? ' selected' : '') + '>自定义...</option>';
          }
          selectHtml += '</select>';
          row.innerHTML =
            '<label for="param-' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</label>' +
            selectHtml +
            '<input type="text" id="param-' + escapeHtml(p.name) + '-custom" data-param="' + escapeHtml(p.name) + '" value="' + (isCustom ? escapeHtml(String(val)) : '') + '" placeholder="输入自定义值..." style="display:' + (isCustom ? '' : 'none') + '; margin-top:0.25rem;" autocomplete="off" spellcheck="false">' +
            '<span class="param-desc" title="' + escapeHtml(p.description || '') + '">' + escapeHtml(p.description || '') + '</span>';
        } else {
          var inputType = p.type === 'number' ? 'number' : 'text';
          var val = value != null ? value : p.default;
          val = val != null ? val : '';
          var datalistAttr = p.datalist ? ' list="' + escapeHtml(p.datalist) + '"' : '';
          row.innerHTML =
            '<label for="param-' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</label>' +
            '<input id="param-' + escapeHtml(p.name) + '" type="' + inputType + '" data-param="' + escapeHtml(p.name) + '" value="' + escapeHtml(String(val)) + '" ' +
            'min="' + (p.min != null ? p.min : '') + '" max="' + (p.max != null ? p.max : '') + '" step="' + (p.step != null ? p.step : '') + '" placeholder="' + escapeHtml(p.placeholder || '') + '…" ' +
            'autocomplete="off" spellcheck="false"' + datalistAttr + '>' +
            '<span class="param-desc" title="' + escapeHtml(p.description || '') + '">' + escapeHtml(p.description || '') + '</span>';
        }
        paramsDiv.appendChild(row);
      });
      formContainer.appendChild(paramsDiv);
    }

    if (hasMessages) {
      var messages = (currentConfig.body && currentConfig.body.messages) || [];
      var msgDiv = document.createElement('div');
      msgDiv.innerHTML = '<h3>messages</h3>';
      var msgTmpl = document.getElementById('tmplMsgRow');
      messages.forEach(function (m, idx) {
        var clone = msgTmpl.content.cloneNode(true);
        var roleSelect = clone.querySelector('.msg-role');
        roleSelect.id = 'msg-role-' + idx;
        roleSelect.dataset.msgIdx = idx;
        roleSelect.value = m.role || 'user';
        var labels = clone.querySelectorAll('label');
        if (labels.length >= 2) {
          labels[0].setAttribute('for', 'msg-role-' + idx);
          labels[1].setAttribute('for', 'msg-content-' + idx);
        }
        var contentTextarea = clone.querySelector('.msg-content');
        contentTextarea.id = 'msg-content-' + idx;
        contentTextarea.dataset.msgIdx = idx;
        contentTextarea.textContent = m.content || '';
        var delBtn = clone.querySelector('.danger');
        delBtn.dataset.msgIdx = idx;
        msgDiv.appendChild(clone);
      });

      var addMsgBtn = document.createElement('button');
      addMsgBtn.type = 'button';
      addMsgBtn.textContent = '+ 添加消息';
      addMsgBtn.addEventListener('click', function () {
        currentConfig.body.messages.push({ role: 'user', content: '' });
        renderFormMode();
        updateJsonPreview();
      });
      msgDiv.appendChild(addMsgBtn);

      formContainer.appendChild(msgDiv);
    }

    var customDiv = document.createElement('div');
    customDiv.innerHTML = '<h3>自定义参数</h3>';

    var presetSelect = document.createElement('select');
    presetSelect.id = 'customParamPreset';
    presetSelect.innerHTML = PRESET_OPTIONS_HTML;
    presetSelect.addEventListener('change', function (e) {
      var idx = parseInt(e.target.value);
      if (isNaN(idx)) return;
      var preset = C.CUSTOM_PARAM_PRESETS[idx];
      var exists = currentConfig.customParams.some(function (p) { return p.key === preset.key; });
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
    var presetRow = document.createElement('div');
    presetRow.className = 'param-row';
    presetRow.appendChild(presetSelect);
    customDiv.appendChild(presetRow);

    currentConfig.customParams.forEach(function (p, idx) {
      var row = document.createElement('div');
      row.className = 'param-row';
      var preset = C.CUSTOM_PARAM_PRESETS.find(function (cp) { return cp.key === p.key; });
      var desc = preset ? preset.description : '';
      row.innerHTML =
        '<input type="text" value="' + escapeHtml(p.key) + '" data-custom-idx="' + idx + '" class="custom-key" placeholder="参数名…" aria-label="自定义参数名" spellcheck="false" autocomplete="off" title="' + escapeHtml(desc) + '">' +
        '<input type="text" value="' + escapeHtml(String(p.value)) + '" data-custom-idx="' + idx + '" class="custom-value" placeholder="参数值（JSON 字符串或普通文本）…" aria-label="自定义参数值" spellcheck="false" autocomplete="off" title="' + escapeHtml(desc) + '">' +
        '<button type="button" class="icon-btn danger" data-custom-idx="' + idx + '" aria-label="删除自定义参数" title="删除">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' +
        '</button>';
      customDiv.appendChild(row);
    });
    formContainer.appendChild(customDiv);
  }

  function syncFormToConfig() {
    var roles = document.querySelectorAll('.msg-role');
    var contents = document.querySelectorAll('.msg-content');
    if (!currentConfig.body) currentConfig.body = {};
    currentConfig.body.messages = Array.from(roles).map(function (select, idx) {
      return {
        role: select.value,
        content: contents[idx] ? (contents[idx].value || '') : ''
      };
    });

    var currentParams = C.getEndpointParams(currentConfig.endpointPath);
    document.querySelectorAll('[data-param]').forEach(function (input) {
      var name = input.dataset.param;
      var param = currentParams.find(function (p) { return p.name === name; });
      if (!param) return;

      if (input.id && input.id.endsWith('-custom')) return;

      var value;
      if (param.type === 'checkbox') {
        value = input.checked;
      } else if (param.type === 'select') {
        var selectVal = input.value;
        if (selectVal === '__custom__') {
          var customInput = document.getElementById('param-' + name + '-custom');
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
            var validation = C.validateParamValue(name, value, param);
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
      var key = input.value.trim();
      var valInputs = document.querySelectorAll('.custom-value');
      var valInput = valInputs[idx];
      var value = valInput ? valInput.value.trim() : '';
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
    var body = C.deepClone(currentConfig.body);

    currentConfig.customParams.forEach(function (p) {
      body[p.key] = p.value;
    });

    var headers = {};
    currentConfig.headers.forEach(function (h) {
      if (h.key) {
        headers[h.key] = maskSensitive ? C.maskSensitiveValue(h.key, h.value) : h.value;
      }
    });

    var fullConfig = {
      baseUrl: baseUrlInput.value.trim(),
      endpointPath: getEndpointPathValue(),
      httpMethod: httpMethodSelect.value,
      headers: headers,
      body: body
    };

    return JSON.stringify(fullConfig, null, 2);
  }

  function jsonToFullConfig(json) {
    try {
      var fullConfig = JSON.parse(json);

      if (fullConfig.baseUrl !== undefined) {
        baseUrlInput.value = fullConfig.baseUrl;
        currentConfig.baseUrl = fullConfig.baseUrl;
      }
      if (fullConfig.endpointPath !== undefined) {
        currentConfig.endpointPath = fullConfig.endpointPath;
      }
      if (fullConfig.httpMethod !== undefined) {
        httpMethodSelect.value = fullConfig.httpMethod;
        currentConfig.httpMethod = fullConfig.httpMethod;
      }

      if (fullConfig.headers && typeof fullConfig.headers === 'object') {
        currentConfig.headers = Object.entries(fullConfig.headers).map(function (entry) {
          return { key: entry[0], value: entry[1] };
        });
        renderHeaders();
      }

      if (fullConfig.body && typeof fullConfig.body === 'object') {
        currentConfig.body = fullConfig.body;
        currentConfig.customParams = [];
      } else if (fullConfig.body === undefined && fullConfig.model !== undefined) {
        var body = Object.assign({}, fullConfig);
        delete body.baseUrl;
        delete body.endpointPath;
        delete body.httpMethod;
        delete body.headers;
        currentConfig.body = body;
        currentConfig.customParams = [];
      }

      if (currentConfig.body && typeof currentConfig.body === 'object') {
        var extracted = C.extractPresetParamsFromBody(currentConfig.body, currentConfig.endpointPath, currentConfig.customParams);
        currentConfig.body = extracted.body;
        currentConfig.customParams = extracted.customParams;
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

  var debouncedUpdateJsonPreview = debounce(updateJsonPreview, C.JSON_PREVIEW_DELAY_MS);

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
      var json = requestJson.value;
      if (jsonToFullConfig(json)) {
        jsonError.textContent = '';
      }
    } finally {
      _syncSource = null;
    }
  }

  var debouncedSyncJsonToForm = debounce(syncJsonToForm, C.JSON_SYNC_DELAY_MS);

  function setActiveTab(tab, bar) {
    if (!tab || !bar) return;
    bar.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
  }

  function buildRequestParams() {
    syncFormToConfig();

    var base = baseUrlInput.value.trim().replace(/\/+$/, '');
    var rawPath = getEndpointPathValue();
    var path = rawPath.replace(/^\/+/, '/');
    var url = base + (path ? '/' + path : '');

    var headers = {};
    currentConfig.headers.forEach(function (h) {
      if (h.key) headers[h.key] = h.value;
    });

    var body = fullConfigToJson(false);
    try {
      var fullConfig = JSON.parse(body);
      body = JSON.stringify(fullConfig.body, null, 2);
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

  function showToast(message, type) {
    type = type || 'info';
    var container = $('toastContainer');
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      toast.remove();
    }, C.TOAST_DISPLAY_MS);
  }

  function sanitizeHeadersForStorage(headers) {
    var sanitized = {};
    Object.entries(headers).forEach(function (entry) {
      var key = entry[0], val = entry[1];
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

  async function sendRequest(retryCount) {
    retryCount = retryCount || 0;
    var params = buildRequestParams();
    if (!params.url) {
      showToast('请先填写 Base URL 和端点路径', 'error');
      return;
    }

    if (retryCount === 0) {
      var placeholderWarnings = checkPlaceholderApiKey();
      if (placeholderWarnings.length > 0) {
        showToast('检测到 ' + placeholderWarnings.join('、') + ' 仍为占位符，请替换为真实的 API Key', 'error');
        return;
      }
    }

    var isStreaming = false;
    try {
      var bodyObj = JSON.parse(params.body || '{}');
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

    var timeoutId = setTimeout(function () {
      if (abortController) {
        abortController.abort();
        showToast('请求超时（' + (REQUEST_TIMEOUT_MS / 1000) + ' 秒），请检查网络或 API 服务状态', 'error');
      }
    }, REQUEST_TIMEOUT_MS);

    var requestHeaders = Object.assign({}, params.headers);
    if (params.method === 'POST' || params.method === 'PUT' || params.method === 'PATCH') {
      if (retryCount === 0) {
        requestHeaders['Idempotency-Key'] = generateIdempotencyKey();
      }
    }

    var options = {
      method: params.method,
      headers: requestHeaders,
      body: params.body,
      signal: abortController.signal
    };

    try {
      var response = await fetch(params.url, options);
      clearTimeout(timeoutId);
      var httpStatus = response.status;
      httpStatusSpan.textContent = httpStatus;

      if (httpStatus === 429 && retryCount < MAX_RETRIES) {
        var retryAfter = response.headers.get('retry-after');
        var delay;
        if (retryAfter) {
          var retrySeconds = parseInt(retryAfter, 10);
          if (!isNaN(retrySeconds)) {
            delay = retrySeconds * 1000;
          } else {
            var retryDate = new Date(retryAfter);
            delay = Math.max(0, retryDate.getTime() - Date.now());
          }
        } else {
          delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
        }
        showToast('遇到速率限制 (429)，' + Math.round(delay / 1000) + ' 秒后重试…', 'warning');
        sendBtn.innerHTML = '<span class="spinner"></span>等待重试 (' + Math.round(delay / 1000) + 's)…';
        await new Promise(function (r) { setTimeout(r, delay); });
        return sendRequest(retryCount + 1);
      }
      if ((httpStatus === 502 || httpStatus === 503 || httpStatus === 504) && retryCount < MAX_RETRIES) {
        var delay = 1000 + Math.random() * 1000;
        showToast('服务器暂时不可用 (' + httpStatus + ')，' + Math.round(delay / 1000) + ' 秒后重试…', 'warning');
        await new Promise(function (r) { setTimeout(r, delay); });
        return sendRequest(retryCount + 1);
      }

      var contentType = response.headers.get('content-type') || '';
      var isJson = contentType.includes('application/json');
      var isSse = contentType.includes('text/event-stream') || isStreaming;

      if (isSse && response.body) {
        await handleSseResponse(response);
        var duration = Date.now() - requestStartTime;
        durationSpan.textContent = duration + ' ms';
        addHistory(params, httpStatus, duration);
        sendBtn.disabled = false;
        sendBtn.textContent = '发送请求';
        abortBtn.disabled = true;
        abortController = null;
        return;
      }

      var responseClone = response.clone();
      var responseText = await response.text();
      currentRawResponseText = responseText;

      if (isJson) {
        currentResponseType = 'json';
        if (!responseText || responseText.trim() === '') {
          renderTextResponse('（服务器返回了空的 JSON 响应）', contentType);
          showToast('响应体为空，请检查请求参数或 API Key 是否有效', 'warning');
        } else {
          try {
            var json = JSON.parse(responseText);
            currentResponseData = json;
            renderResponse(json);
          } catch (parseErr) {
            renderTextResponse('JSON 解析失败：' + parseErr.message + '\n\n原始响应：\n' + responseText, contentType);
          }
        }
      } else if (contentType.includes('image/') || contentType.includes('audio/') || contentType.includes('video/')) {
        currentResponseType = 'blob';
        var blob = await responseClone.blob();
        currentResponseData = blob;
        renderBlobResponse(blob, contentType);
      } else {
        currentResponseType = 'text';
        currentResponseData = responseText;
        renderTextResponse(responseText, contentType);
      }

      var duration = Date.now() - requestStartTime;
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
        var delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
        showToast('网络错误，' + Math.round(delay / 1000) + ' 秒后重试…', 'warning');
        sendBtn.innerHTML = '<span class="spinner"></span>等待重试 (' + Math.round(delay / 1000) + 's)…';
        await new Promise(function (r) { setTimeout(r, delay); });
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
    var reader = response.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buffer = '';
    var fullContent = '';
    var fullEvents = [];
    var lastEventId = null;
    currentResponseType = 'stream';

    while (true) {
      var result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });

      var lines = buffer.split('\n');
      buffer = lines.pop() || '';

      var currentEvent = null;
      var currentData = '';

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];

        if (line === '') {
          if (currentData) {
            var data = currentData;
            currentData = '';
            if (data === '[DONE]') {
              currentEvent = null;
              continue;
            }
            try {
              var event = JSON.parse(data);
              if (lastEventId) event._lastEventId = lastEventId;
              fullEvents.push(event);

              var deltaText = '';
              if (event.choices && event.choices[0] && event.choices[0].delta) {
                deltaText = event.choices[0].delta.content || '';
                var reasoning = event.choices[0].delta.reasoning_content;
                if (reasoning) {
                  deltaText = '[思考] ' + reasoning + '\n' + deltaText;
                }
              } else if (event.output && event.output[0] && event.output[0].content && event.output[0].content[0] && event.output[0].content[0].text) {
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
          // SSE retry 字段，忽略
        } else if (line.startsWith('data:')) {
          currentData += line.substring(5).trim();
        } else if (line.startsWith(':')) {
          // SSE 注释，忽略
        }
      }
    }

    if (buffer.trim()) {
      var remaining = buffer.trim();
      if (remaining.startsWith('data:')) {
        var data = remaining.replace(/^data:\s*/, '');
        if (data !== '[DONE]') {
          try {
            var event = JSON.parse(data);
            fullEvents.push(event);
            var deltaText = '';
            if (event.choices && event.choices[0] && event.choices[0].delta) {
              deltaText = event.choices[0].delta.content || '';
            } else if (event.output && event.output[0] && event.output[0].content && event.output[0].content[0] && event.output[0].content[0].text) {
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
    currentRawResponseText = fullEvents.map(function (e) { return JSON.stringify(e); }).join('\n');
    renderTextResponse(fullContent, 'text/plain');
  }

  function renderStreamingText(text) {
    responseContainer.innerHTML = '';
    var pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = text;
    responseContainer.appendChild(pre);
  }

  function renderResponse(data) {
    responseContainer.innerHTML = '';
    var json = JSON.stringify(data, null, 2);
    var pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = json;
    responseContainer.appendChild(pre);
  }

  function renderTextResponse(text, contentType) {
    responseContainer.innerHTML = '';
    var pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = text;
    responseContainer.appendChild(pre);
  }

  function renderBlobResponse(blob, contentType) {
    responseContainer.innerHTML = '';
    var url = URL.createObjectURL(blob);

    if (contentType.startsWith('image/')) {
      var img = document.createElement('img');
      img.src = url;
      img.alt = 'API 响应图片';
      responseContainer.appendChild(img);
    } else if (contentType.startsWith('audio/')) {
      var audio = document.createElement('audio');
      audio.controls = true;
      audio.src = url;
      responseContainer.appendChild(audio);
    } else if (contentType.startsWith('video/')) {
      var video = document.createElement('video');
      video.controls = true;
      video.src = url;
      responseContainer.appendChild(video);
    } else {
      var a = document.createElement('a');
      a.href = url;
      a.download = 'response';
      a.textContent = '下载响应文件';
      responseContainer.appendChild(a);
    }
  }

  function addHistory(params, httpStatus, duration) {
    var item = {
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
    if (history.length > C.MAX_HISTORY_ITEMS) history = history.slice(0, C.MAX_HISTORY_ITEMS);
    C.saveHistory(history);
    renderHistory();
  }

  function renderHistory() {
    historyList.innerHTML = '';
    if (history.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'empty-state';
      empty.textContent = '暂无历史记录，发送请求后会自动保存';
      empty.style.cursor = 'default';
      historyList.appendChild(empty);
      return;
    }
    var dtFormat = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var tmpl = document.getElementById('tmplHistoryItem');
    history.forEach(function (item) {
      var clone = tmpl.content.cloneNode(true);
      var li = clone.querySelector('li');
      li.dataset.id = item.id;
      li.setAttribute('aria-label', item.method + ' ' + item.httpStatus + ' ' + item.url);
      li.querySelector('.history-time').textContent = dtFormat.format(new Date(item.timestamp));
      li.querySelector('.history-status').textContent = item.method + ' ' + item.httpStatus + ' ' + item.duration + 'ms';
      li.querySelector('.history-url').textContent = item.url;
      historyList.appendChild(clone);
    });
  }

  function loadHistoryToConfig(id) {
    var item = history.find(function (h) { return h.id === id; });
    if (!item) return;

    var baseUrl, endpointPath;
    try {
      var url = new URL(item.url);
      var knownEndpoints = Object.keys(C.ENDPOINT_TEMPLATES);
      var matchedEndpoint = knownEndpoints.find(function (ep) { return url.pathname.endsWith(ep); });
      if (matchedEndpoint) {
        endpointPath = matchedEndpoint;
        baseUrl = item.url.substring(0, item.url.lastIndexOf(matchedEndpoint));
      } else {
        var pathParts = url.pathname.split('/').filter(Boolean);
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
    currentConfig.endpointPath = endpointPath;
    httpMethodSelect.value = item.method;

    currentConfig.headers = Object.entries(item.headers).map(function (entry) {
      return { key: entry[0], value: entry[1] };
    });
    renderHeaders();

    try {
      var body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
      currentConfig.body = body;
      currentConfig.customParams = [];

      var extracted = C.extractPresetParamsFromBody(currentConfig.body, endpointPath, currentConfig.customParams);
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

  function restoreFromUrlParams() {
    var params = new URLSearchParams(location.search);
    var config = params.get('config');
    if (!config) return;
    try {
      var decoded = JSON.parse(decodeURIComponent(config));
      if (decoded.baseUrl) baseUrlInput.value = decoded.baseUrl;
      if (decoded.endpointPath) currentConfig.endpointPath = decoded.endpointPath;
      if (decoded.httpMethod) httpMethodSelect.value = decoded.httpMethod;
      if (decoded.headers) {
        var safeHeaders = Object.entries(decoded.headers)
          .filter(function (entry) { return !C.isSensitiveHeader(entry[0]); })
          .map(function (entry) { return { key: entry[0], value: entry[1] }; });
        currentConfig.headers = safeHeaders;
        var removedCount = Object.keys(decoded.headers).length - safeHeaders.length;
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
    var config = {
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
    return location.origin + location.pathname + '?config=' + encodeURIComponent(JSON.stringify(config));
  }

  function bindEvents() {
    baseUrlInput.addEventListener('input', updateFinalUrl);

    var fetchModelsTimer = null;
    baseUrlInput.addEventListener('input', function () {
      clearTimeout(fetchModelsTimer);
      var base = baseUrlInput.value.trim();
      if (!base) return;
      fetchModelsTimer = setTimeout(fetchModels, C.FETCH_MODELS_DEBOUNCE_MS);
    });

    fetchModelsBtn.addEventListener('click', fetchModels);

    function getCurrentEndpointPath() {
      return getEndpointPathValue();
    }

    function setEndpointMode(isCustom, value) {
      var combo = document.querySelector('.endpoint-path-combo');
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

    endpointPathSelect.addEventListener('change', function () {
      var val = endpointPathSelect.value;
      var prevEndpoint = currentConfig.endpointPath;
      if (val === 'custom') {
        setEndpointMode(true, '');
        updateFinalUrl();
        return;
      }

      endpointPathInput.value = val;

      if (val === '/models') {
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
      var presetOptions = Array.from(endpointPathSelect.options).map(function (o) { return o.value; });
      var val = endpointPathInput.value.trim();
      if (presetOptions.includes(val)) {
        setEndpointMode(false, val);
        endpointPathSelect.dispatchEvent(new Event('change'));
      }
    });
    httpMethodSelect.addEventListener('change', updateFinalUrl);

    addHeaderBtn.addEventListener('click', function () {
      currentConfig.headers.push({ key: '', value: '' });
      renderHeaders();
    });

    headersContainer.addEventListener('click', function (e) {
      if (e.target.matches('.danger')) {
        var idx = +e.target.dataset.idx;
        currentConfig.headers.splice(idx, 1);
        renderHeaders();
      }
    });

    headersContainer.addEventListener('input', function (e) {
      var idx = +e.target.dataset.idx;
      if (e.target.matches('.header-key')) {
        currentConfig.headers[idx].key = e.target.value;
      } else if (e.target.matches('.header-value')) {
        currentConfig.headers[idx].value = e.target.value;
      }
    });

    var responseBar = document.querySelector('.response-card .tab-bar');
    if (responseBar) {
      responseBar.addEventListener('click', function (e) {
        if (e.target.matches('.tab')) {
          var view = e.target.dataset.view;
          if (view) switchView(view);
          setActiveTab(e.target, responseBar);
        }
      });
    }

    formContainer.addEventListener('input', debouncedUpdateJsonPreview);
    formContainer.addEventListener('change', function (e) {
      if (e.target.matches('select[data-param]')) {
        var select = e.target;
        var customInput = document.getElementById(select.id + '-custom');
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
        var idx = +e.target.dataset.idx;
        if (idx !== idx) idx = +e.target.dataset.customIdx;
        if (idx !== idx) idx = +e.target.dataset.msgIdx;
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
        var obj = JSON.parse(requestJson.value);
        requestJson.value = JSON.stringify(obj, null, 2);
        jsonError.textContent = '';
      } catch (e) {
        jsonError.textContent = '格式化失败：' + e.message + '，请检查 JSON 语法是否正确';
      }
    });

    parseJsonBtn.addEventListener('click', function () {
      syncJsonToForm();
    });

    var jsonParseDebounceTimer = null;
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
      var li = e.target.closest('li');
      if (!li) return;
      var id = +li.dataset.id;
      loadHistoryToConfig(id);
    });

    historyList.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        var li = e.target.closest('li');
        if (!li) return;
        var id = +li.dataset.id;
        loadHistoryToConfig(id);
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
        history = [];
        C.saveHistory(history);
        renderHistory();
      });
    });

    exportHistoryBtn.addEventListener('click', function () {
      var safeHistory = history.map(function (item) {
        var safeItem = Object.assign({}, item);
        if (safeItem.headers) {
          var safeHeaders = {};
          Object.entries(safeItem.headers).forEach(function (entry) {
            var key = entry[0], val = entry[1];
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
      var blob = new Blob([JSON.stringify(safeHistory, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'openai_debugger_history.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    function switchView(view) {
      if (!currentResponseData && !currentRawResponseText) return;

      if (view === 'raw') {
        responseContainer.innerHTML = '';
        var pre = document.createElement('pre');
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordBreak = 'break-all';
        if (currentResponseType === 'json' && currentResponseData) {
          pre.textContent = JSON.stringify(currentResponseData, null, 2);
        } else if (currentResponseType === 'blob') {
          pre.textContent = '[二进制数据] ' + (currentResponseData && currentResponseData.type ? currentResponseData.type : 'unknown') + '，大小: ' + (currentResponseData && currentResponseData.size ? currentResponseData.size : '?') + ' bytes';
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
          var fullContent = '';
          for (var i = 0; i < currentResponseData.length; i++) {
            var event = currentResponseData[i];
            var deltaText = '';
            if (event.choices && event.choices[0] && event.choices[0].delta) {
              deltaText = event.choices[0].delta.content || '';
              var reasoning = event.choices[0].delta.reasoning_content;
              if (reasoning) {
                deltaText = '[思考] ' + reasoning + '\n' + deltaText;
              }
            } else if (event.output && event.output[0] && event.output[0].content && event.output[0].content[0] && event.output[0].content[0].text) {
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

    shareUrlBtn.addEventListener('click', function () {
      syncFormToConfig();
      var url = buildShareUrl();
      showConfirm('分享链接会将 Base URL、端点路径和请求参数（含 messages 内容）编码到 URL 中，该内容可能被浏览器历史、服务器日志等记录。确定要复制分享链接吗？', function () {
        navigator.clipboard.writeText(url).then(function () {
          showToast('分享链接已复制到剪贴板', 'success');
        }).catch(function () {
          prompt('复制链接（请手动复制）：', url);
        });
      });
    });

    saveConfigBtn.addEventListener('click', function () {
      var name = configNameInput.value.trim();
      if (!name) {
        showToast('请输入配置名称', 'error');
        return;
      }
      syncFormToConfig();
      var configData = {
        baseUrl: baseUrlInput.value.trim(),
        endpointPath: getEndpointPathValue(),
        httpMethod: httpMethodSelect.value,
        headers: currentConfig.headers.map(function (h) { return { key: h.key, value: h.value }; }),
        body: C.deepClone(currentConfig.body),
        customParams: C.deepClone(currentConfig.customParams)
      };
      var action = C.saveConfig(name, configData);
      renderConfigSelect();
      configNameInput.value = '';
      showToast('配置「' + name + '」已' + action, 'success');
    });

    loadConfigBtn.addEventListener('click', function () {
      var name = configSelect.value;
      if (!name) {
        showToast('请选择一个配置', 'error');
        return;
      }
      var saved = C.getConfigByName(name);
      if (!saved) {
        showToast('配置不存在', 'error');
        return;
      }
      loadSavedConfig(saved);
    });

    deleteConfigBtn.addEventListener('click', function () {
      var name = configSelect.value;
      if (!name) {
        showToast('请选择一个配置', 'error');
        return;
      }
      showConfirm('确定要删除配置「' + name + '」吗？', function () {
        C.deleteConfig(name);
        renderConfigSelect();
        configSelect.value = '';
        showToast('配置「' + name + '」已删除', 'info');
      });
    });

    exportConfigBtn.addEventListener('click', function () {
      syncFormToConfig();
      var configData = {
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
      var blob = new Blob([JSON.stringify(configData, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'openai_config_' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('配置已导出（敏感请求头已脱敏）', 'success');
    });

    importConfigBtn.addEventListener('click', function () {
      importConfigFile.click();
    });

    importConfigFile.addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (event) {
        try {
          var configData = JSON.parse(event.target.result);
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
      currentConfig.endpointPath = saved.endpointPath;
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
      var extracted = C.extractPresetParamsFromBody(currentConfig.body, currentConfig.endpointPath, currentConfig.customParams);
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

  function renderConfigSelect() {
    var configs = C.loadSavedConfigs();
    configSelect.innerHTML = '<option value="">-- 选择已保存的配置 --</option>';
    configs.forEach(function (cfg) {
      var option = document.createElement('option');
      option.value = cfg.name;
      option.textContent = cfg.name;
      configSelect.appendChild(option);
    });
  }

  function showConfirm(message, onConfirm) {
    var overlay = document.createElement('div');
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

    overlay.querySelector('.confirm-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('.confirm-ok').addEventListener('click', function () {
      overlay.remove();
      onConfirm();
    });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') overlay.remove();
    });
    overlay.querySelector('.confirm-ok').focus();
  }

  function openPanel(panelId) {
    [savedConfigsPanel, historyPanel].forEach(function (panel) {
      if (panel) panel.classList.remove('open');
    });
    var targetPanel = $(panelId);
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
    var configs = C.loadSavedConfigs();
    configSubmenuList.innerHTML = '';
    if (configs.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'sidebar-config-item';
      empty.style.cursor = 'default';
      empty.innerHTML = '<span class="config-name" style="color:var(--text-muted)">暂无保存的配置</span>';
      configSubmenuList.appendChild(empty);
      return;
    }
    configs.forEach(function (cfg) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'sidebar-config-item';
      item.innerHTML =
        '<span class="config-name">' + escapeHtml(cfg.name) + '</span>' +
        '<span class="config-actions">' +
        '<button type="button" class="config-delete" data-config-name="' + escapeHtml(cfg.name) + '" title="删除">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>' +
        '</button>' +
        '</span>';
      item.addEventListener('click', function (e) {
        if (e.target.closest('.config-delete')) return;
        loadSavedConfig(cfg.data);
        showToast('配置「' + cfg.name + '」已加载', 'success');
      });
      var delBtn = item.querySelector('.config-delete');
      if (delBtn) {
        delBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var name = delBtn.dataset.configName;
          showConfirm('确定要删除配置「' + name + '」吗？', function () {
            C.deleteConfig(name);
            renderSidebarConfigs();
            renderConfigSelect();
            showToast('配置「' + name + '」已删除', 'info');
          });
        });
      }
      configSubmenuList.appendChild(item);
    });
  }

  function initSidebar() {
    sidebarItems.forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        var panel = item.dataset.panel;

        sidebarItems.forEach(function (i) { i.classList.remove('active'); });
        item.classList.add('active');

        if (panel === 'config') {
          closeAllPanels();
        } else if (panel === 'saved-configs') {
          renderSidebarConfigs();
          if (configExpandBtn) {
            configExpandBtn.classList.toggle('expanded');
            if (configSubmenu) configSubmenu.classList.toggle('open');
          }
          item.classList.remove('active');
          var configItem = document.querySelector('.sidebar-item[data-panel="config"]');
          if (configItem) configItem.classList.add('active');
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
        var name = quickConfigName.value.trim();
        if (!name) {
          showToast('请输入配置名称', 'error');
          return;
        }
        syncFormToConfig();
        var configData = {
          baseUrl: baseUrlInput.value.trim(),
          endpointPath: getEndpointPathValue(),
          httpMethod: httpMethodSelect.value,
          headers: currentConfig.headers.map(function (h) { return { key: h.key, value: h.value }; }),
          body: C.deepClone(currentConfig.body),
          customParams: C.deepClone(currentConfig.customParams)
        };
        var action = C.saveConfig(name, configData);
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
        var configItem = document.querySelector('.sidebar-item[data-panel="config"]');
        if (configItem) configItem.classList.add('active');
      });
    }

    document.querySelectorAll('.side-panel-close').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeAllPanels();
        sidebarItems.forEach(function (i) { i.classList.remove('active'); });
        var configItem = document.querySelector('.sidebar-item[data-panel="config"]');
        if (configItem) configItem.classList.add('active');
      });
    });
  }

  initSidebar();
  init();
})();
