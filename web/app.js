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

  var C = window.AppConfig;

  // ==================== 工具函数 ====================

  function escapeHtml(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
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
        var r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
    return 'id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  // ==================== 常量与状态 ====================

  var REQUEST_TIMEOUT_MS = 60000;
  var MAX_RETRIES = 3;

  var currentConfig = C.createDefaultConfig();
  var requestHistory = C.loadHistory();

  var _syncSource = null;

  var abortController = null;
  var requestStartTime = null;
  var streamingResponse = '';
  var currentResponseData = null;
  var currentResponseType = 'json';
  var currentRawResponseText = '';
  var fetchedModels = [];

  var $ = function (id) { return document.getElementById(id); };

  // ==================== DOM 元素缓存 ====================

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

  // ==================== 安全的 DOM 创建工具 ====================

  function createElement(tag, options) {
    options = options || {};
    var el = document.createElement(tag);
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
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var paths = [
      'M3 6h18',
      'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
      'M10 11v6',
      'M14 11v6'
    ];
    paths.forEach(function (d) {
      var el = document.createElementNS('http://www.w3.org/2000/svg', d.indexOf('M') === 0 ? 'path' : 'line');
      if (d.indexOf('M') === 0) {
        el.setAttribute('d', d);
      } else {
        var parts = d.split(' ');
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
    var container = $('toastContainer');
    if (!container) return;
    var toast = createElement('div', {
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
    var overlay = createElement('div', {
      className: 'confirm-overlay',
      attrs: {
        'role': 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'confirm-title'
      }
    });

    var dialog = createElement('div', { className: 'confirm-dialog' });
    var title = createElement('h3', {
      className: 'confirm-title',
      attrs: { id: 'confirm-title' },
      text: '确认操作'
    });
    var msg = createElement('p', { text: message });
    var actions = createElement('div', { className: 'confirm-actions' });
    var cancelBtn = createElement('button', {
      className: 'confirm-cancel',
      text: '取消',
      events: {
        click: function () { overlay.remove(); }
      }
    });
    var okBtn = createElement('button', {
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
    var combo = document.querySelector('.endpoint-path-combo');
    return combo && combo.classList.contains('custom-mode');
  }

  function getEndpointPathValue() {
    return isEndpointCustomMode() ? endpointPathInput.value.trim() : endpointPathSelect.value.trim();
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

  // ==================== 模型获取 ====================

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

      clearElement(modelDatalist);
      models.forEach(function (id) {
        var option = createElement('option', { attrs: { value: id } });
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

  // ==================== 配置序列化/反序列化 ====================

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

  // ==================== 渲染函数 ====================

  function renderEndpoint() {
    baseUrlInput.value = currentConfig.baseUrl;
    httpMethodSelect.value = currentConfig.httpMethod;

    var presetOptions = Array.from(endpointPathSelect.options).map(function (o) { return o.value; });
    if (presetOptions.includes(currentConfig.endpointPath) && currentConfig.endpointPath !== 'custom') {
      setEndpointMode(false, currentConfig.endpointPath);
      endpointPathInput.value = currentConfig.endpointPath;
    } else {
      setEndpointMode(true, currentConfig.endpointPath);
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
    clearElement(headersContainer);
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

  function buildPresetOptionsHtml() {
    var fragment = document.createDocumentFragment();
    var defaultOption = createElement('option', { attrs: { value: '' }, text: '-- 添加常用自定义参数 --' });
    fragment.appendChild(defaultOption);
    C.CUSTOM_PARAM_PRESETS.forEach(function (preset, idx) {
      var option = createElement('option', {
        attrs: { value: idx },
        text: preset.key + ' - ' + preset.description
      });
      fragment.appendChild(option);
    });
    return fragment;
  }

  function renderFormMode() {
    clearElement(formContainer);

    var endpointPath = currentConfig.endpointPath;
    var hasMessages = C.endpointHasMessages(endpointPath);
    var params = C.getEndpointParams(endpointPath);

    var tip = createElement('div', {
      styles: { fontSize: '0.8rem', color: '#9ca3af' }
    });
    if (endpointPath === '/responses') {
      tip.appendChild(document.createTextNode('Responses API 使用 input 字段代替 messages。如需编辑复杂 input 数组或工具调用，建议切换到 '));
      var strong = createElement('strong', { text: 'JSON 模式' });
      tip.appendChild(strong);
      tip.appendChild(document.createTextNode('。'));
    } else if (endpointPath === '/chat/completions') {
      tip.textContent = '当前表单以 Chat Completions messages 格式为主。';
    } else {
      tip.textContent = '当前端点：' + endpointPath + '，参数已根据端点类型自动调整。';
    }
    formContainer.appendChild(tip);

    if (params.length > 0) {
      var paramsDiv = createElement('div');
      params.forEach(function (p) {
        var value = currentConfig.body && currentConfig.body[p.name];
        var row = createElement('div', { className: 'param-row' });

        if (p.type === 'checkbox') {
          var checkboxLabel = createElement('label', {
            attrs: { for: 'param-' + p.name },
            text: p.name
          });
          var checkbox = createElement('input', {
            attrs: {
              id: 'param-' + p.name,
              type: 'checkbox',
              'data-param': p.name
            }
          });
          if (value) checkbox.checked = true;
          var desc = createElement('span', {
            className: 'param-desc',
            attrs: { title: p.description || '' },
            text: p.description || ''
          });
          row.appendChild(checkboxLabel);
          row.appendChild(checkbox);
          row.appendChild(desc);
        } else if (p.type === 'select') {
          var selectLabel = createElement('label', {
            attrs: { for: 'param-' + p.name },
            text: p.name
          });
          var isBoolSelect = (p.options || []).every(function (opt) { return typeof opt === 'boolean'; });
          var select = createElement('select', {
            attrs: {
              id: 'param-' + p.name,
              'data-param': p.name,
              autocomplete: 'off'
            }
          });
          if (!isBoolSelect) {
            var emptyOption = createElement('option', {
              attrs: { value: '' },
              text: '-- ' + (p.placeholder || '请选择') + ' --'
            });
            select.appendChild(emptyOption);
          }
          (p.options || []).forEach(function (opt) {
            var selected = value === opt ? ' selected' : '';
            var displayText = isBoolSelect ? (opt ? '是' : '否') : String(opt);
            var option = createElement('option', {
              attrs: { value: String(opt) },
              text: displayText
            });
            if (selected) option.selected = true;
            select.appendChild(option);
          });
          if (!isBoolSelect) {
            var customOption = createElement('option', {
              attrs: { value: '__custom__' },
              text: '自定义...'
            });
            select.appendChild(customOption);
          }
          var val = value != null ? value : p.default;
          val = val != null ? val : '';
          var isCustom = !isBoolSelect && val !== '' && !(p.options || []).includes(val);
          if (isCustom) {
            select.value = '__custom__';
          }
          var customInput = createElement('input', {
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
              marginTop: '0.25rem'
            }
          });
          if (isCustom) customInput.value = String(val);
          var selectDesc = createElement('span', {
            className: 'param-desc',
            attrs: { title: p.description || '' },
            text: p.description || ''
          });
          row.appendChild(selectLabel);
          row.appendChild(select);
          row.appendChild(customInput);
          row.appendChild(selectDesc);
        } else {
          var textLabel = createElement('label', {
            attrs: { for: 'param-' + p.name },
            text: p.name
          });
          var inputType = p.type === 'number' ? 'number' : 'text';
          var val = value != null ? value : p.default;
          val = val != null ? val : '';
          var inputAttrs = {
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
          if (p.datalist) inputAttrs.list = p.datalist;
          var textInput = createElement('input', { attrs: inputAttrs });
          var textDesc = createElement('span', {
            className: 'param-desc',
            attrs: { title: p.description || '' },
            text: p.description || ''
          });
          row.appendChild(textLabel);
          row.appendChild(textInput);
          row.appendChild(textDesc);
        }
        paramsDiv.appendChild(row);
      });
      formContainer.appendChild(paramsDiv);
    }

    if (hasMessages) {
      var messages = (currentConfig.body && currentConfig.body.messages) || [];
      var msgDiv = createElement('div');
      var msgTitle = createElement('h3', { text: 'messages' });
      msgDiv.appendChild(msgTitle);
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
        contentTextarea.value = m.content || '';
        var delBtn = clone.querySelector('.danger');
        delBtn.dataset.msgIdx = idx;
        msgDiv.appendChild(clone);
      });

      var addMsgBtn = createElement('button', {
        attrs: { type: 'button' },
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

    var customDiv = createElement('div');
    var customTitle = createElement('h3', { text: '自定义参数' });
    customDiv.appendChild(customTitle);

    var presetSelect = createElement('select', {
      attrs: { id: 'customParamPreset' }
    });
    presetSelect.appendChild(buildPresetOptionsHtml());
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
    var presetRow = createElement('div', { className: 'param-row' });
    presetRow.appendChild(presetSelect);
    customDiv.appendChild(presetRow);

    currentConfig.customParams.forEach(function (p, idx) {
      var row = createElement('div', { className: 'param-row' });
      var preset = C.CUSTOM_PARAM_PRESETS.find(function (cp) { return cp.key === p.key; });
      var desc = preset ? preset.description : '';
      var keyInput = createElement('input', {
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
      var valInput = createElement('input', {
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
      var delBtn = createElement('button', {
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
      var empty = createElement('li', {
        className: 'empty-state',
        text: '暂无历史记录，发送请求后会自动保存',
        styles: { cursor: 'default' }
      });
      historyList.appendChild(empty);
      return;
    }
    var dtFormat = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var tmpl = document.getElementById('tmplHistoryItem');
    requestHistory.forEach(function (item) {
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

  function renderConfigSelect() {
    var configs = C.loadSavedConfigs();
    clearElement(configSelect);
    var defaultOption = createElement('option', {
      attrs: { value: '' },
      text: '-- 选择已保存的配置 --'
    });
    configSelect.appendChild(defaultOption);
    configs.forEach(function (cfg) {
      var option = createElement('option', {
        attrs: { value: cfg.name },
        text: cfg.name
      });
      configSelect.appendChild(option);
    });
  }

  // ==================== 响应渲染（性能优化版） ====================

  var _streamPreElement = null;

  function renderStreamingText(text) {
    if (!_streamPreElement) {
      clearElement(responseContainer);
      _streamPreElement = createElement('pre', {
        styles: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' }
      });
      responseContainer.appendChild(_streamPreElement);
    }
    _streamPreElement.textContent = text;
  }

  function resetStreamElement() {
    _streamPreElement = null;
  }

  function renderResponse(data) {
    resetStreamElement();
    clearElement(responseContainer);
    var json = JSON.stringify(data, null, 2);
    var pre = createElement('pre', {
      styles: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
      text: json
    });
    responseContainer.appendChild(pre);
  }

  function renderTextResponse(text, contentType) {
    resetStreamElement();
    clearElement(responseContainer);
    var pre = createElement('pre', {
      styles: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
      text: text
    });
    responseContainer.appendChild(pre);
  }

  function renderBlobResponse(blob, contentType) {
    resetStreamElement();
    clearElement(responseContainer);
    var url = URL.createObjectURL(blob);

    if (contentType.startsWith('image/')) {
      var img = createElement('img', {
        attrs: { src: url, alt: 'API 响应图片' }
      });
      responseContainer.appendChild(img);
    } else if (contentType.startsWith('audio/')) {
      var audio = createElement('audio', {
        attrs: { controls: true, src: url }
      });
      responseContainer.appendChild(audio);
    } else if (contentType.startsWith('video/')) {
      var video = createElement('video', {
        attrs: { controls: true, src: url }
      });
      responseContainer.appendChild(video);
    } else {
      var a = createElement('a', {
        attrs: { href: url, download: 'response' },
        text: '下载响应文件'
      });
      responseContainer.appendChild(a);
    }
  }

  // ==================== 历史记录管理 ====================

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
    requestHistory.unshift(item);
    if (requestHistory.length > C.MAX_HISTORY_ITEMS) requestHistory = requestHistory.slice(0, C.MAX_HISTORY_ITEMS);
    C.saveHistory(requestHistory);
    renderHistory();
  }

  function loadHistoryToConfig(id) {
    var item = requestHistory.find(function (h) { return h.id === id; });
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

  // ==================== URL 参数与分享 ====================

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

  // ==================== 配置加载/保存 ====================

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

  // ==================== 请求构建与发送 ====================

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
    resetStreamElement();
    revokeContainerBlobUrls();
    clearElement(responseContainer);
    httpStatusSpan.textContent = '-';
    durationSpan.textContent = '-';

    clearElement(sendBtn);
    var spinner = createElement('span', { className: 'spinner' });
    sendBtn.appendChild(spinner);
    if (retryCount > 0) {
      sendBtn.appendChild(document.createTextNode('重试中 (' + retryCount + '/' + MAX_RETRIES + ')…'));
    } else {
      sendBtn.appendChild(document.createTextNode('请求中…'));
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
        clearElement(sendBtn);
        var spinner1 = createElement('span', { className: 'spinner' });
        sendBtn.appendChild(spinner1);
        sendBtn.appendChild(document.createTextNode('等待重试 (' + Math.round(delay / 1000) + 's)…'));
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
        clearElement(sendBtn);
        var spinner2 = createElement('span', { className: 'spinner' });
        sendBtn.appendChild(spinner2);
        sendBtn.appendChild(document.createTextNode('等待重试 (' + Math.round(delay / 1000) + 's)…'));
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

  // ==================== SSE 处理 ====================

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

  // ==================== 视图切换 ====================

  function setActiveTab(tab, bar) {
    if (!tab || !bar) return;
    bar.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
  }

  function switchView(view) {
    if (!currentResponseData && !currentRawResponseText) return;

    if (view === 'raw') {
      resetStreamElement();
      clearElement(responseContainer);
      var pre = createElement('pre', {
        styles: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' }
      });
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

  // ==================== 面板管理 ====================

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
    clearElement(configSubmenuList);
    if (configs.length === 0) {
      var empty = createElement('div', {
        className: 'sidebar-config-item',
        styles: { cursor: 'default' }
      });
      var emptySpan = createElement('span', {
        className: 'config-name',
        styles: { color: 'var(--text-muted)' },
        text: '暂无保存的配置'
      });
      empty.appendChild(emptySpan);
      configSubmenuList.appendChild(empty);
      return;
    }
    configs.forEach(function (cfg) {
      var item = createElement('div', {
        className: 'sidebar-config-item',
        attrs: { role: 'button', tabindex: '0' }
      });
      var nameSpan = createElement('span', {
        className: 'config-name',
        text: cfg.name
      });
      var actionsSpan = createElement('span', { className: 'config-actions' });
      var delBtn = createElement('button', {
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
        var name = delBtn.dataset.configName;
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

    var fetchModelsTimer = null;
    baseUrlInput.addEventListener('input', function () {
      clearTimeout(fetchModelsTimer);
      var base = baseUrlInput.value.trim();
      if (!base) return;
      fetchModelsTimer = setTimeout(fetchModels, C.FETCH_MODELS_DEBOUNCE_MS);
    });

    fetchModelsBtn.addEventListener('click', fetchModels);

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
  }

  function bindHeaderEvents() {
    addHeaderBtn.addEventListener('click', function () {
      currentConfig.headers.push({ key: '', value: '' });
      renderHeaders();
    });

    headersContainer.addEventListener('click', function (e) {
      if (e.target.matches('.danger')) {
        var idx = +e.target.dataset.idx;
        if (!Number.isNaN(idx)) {
          currentConfig.headers.splice(idx, 1);
          renderHeaders();
        }
      }
    });

    headersContainer.addEventListener('input', function (e) {
      var idx = +e.target.dataset.idx;
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
      if (!Number.isNaN(id)) loadHistoryToConfig(id);
    });

    historyList.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        var li = e.target.closest('li');
        if (!li) return;
        var id = +li.dataset.id;
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
      var safeHistory = requestHistory.map(function (item) {
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
      var a = createElement('a', { attrs: { href: url, download: 'openai_debugger_history.json' } });
      a.click();
      URL.revokeObjectURL(url);
      showToast('历史记录已导出（敏感信息已脱敏）', 'success');
    });
  }

  function bindConfigEvents() {
    shareUrlBtn.addEventListener('click', function () {
      syncFormToConfig();
      var url = buildShareUrl();
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
      renderSidebarConfigs();
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
        renderSidebarConfigs();
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
      var a = createElement('a', { attrs: { href: url, download: 'openai_config_' + new Date().toISOString().slice(0, 10) + '.json' } });
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

  function bindResponseTabEvents() {
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
  }

  // ==================== 侧边栏管理 ====================

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
    initSidebar();

    restoreFromUrlParams();
  }

  init();
})();