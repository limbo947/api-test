// app.js – 主逻辑

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let currentConfig = createDefaultConfig();
let configList = loadConfigList();
let history = loadHistory();

let abortController = null;
let requestStartTime = null;
let streamingResponse = '';

// DOM 引用
const $ = id => document.getElementById(id);

const baseUrlInput = $('baseUrl');
const endpointPathInput = $('endpointPath');
const httpMethodSelect = $('httpMethod');
const finalUrlSpan = $('finalUrl');
const headersContainer = $('headersContainer');
const addHeaderBtn = $('addHeaderBtn');

const formMode = $('formMode');
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

const tabBars = document.querySelectorAll('.tab-bar');

// 初始化
function init() {
  renderEndpoint();
  renderHeaders();
  renderFormMode();
  renderHistory();
  updateFinalUrl();
  bindEvents();
  restoreFromUrlParams();
}

// 渲染端点信息
function renderEndpoint() {
  baseUrlInput.value = currentConfig.baseUrl;
  endpointPathInput.value = currentConfig.endpointPath;
  httpMethodSelect.value = currentConfig.httpMethod;
}

// 更新最终 URL 显示
function updateFinalUrl() {
  const base = baseUrlInput.value.trim().replace(/\/+$/, '');
  const path = endpointPathInput.value.trim().replace(/^\/+/, '/');
  const url = base ? (base + path) : '';
  finalUrlSpan.textContent = url;
}

// 渲染请求头列表
function renderHeaders() {
  headersContainer.innerHTML = '';
  currentConfig.headers.forEach((h, idx) => {
    const row = document.createElement('div');
    row.innerHTML = `
      <input type="text" value="${escapeHtml(h.key)}" data-idx="${idx}" class="header-key" aria-label="请求头名称" spellcheck="false" autocomplete="off">
      <input type="text" value="${escapeHtml(h.value)}" data-idx="${idx}" class="header-value" aria-label="请求头值" spellcheck="false" autocomplete="off">
      <button type="button" class="danger small" data-idx="${idx}" aria-label="删除请求头">删除</button>
    `;
    headersContainer.appendChild(row);
  });
}

// 渲染表单模式（Chat Completions 为主，通用化处理）
function renderFormMode() {
  formContainer.innerHTML = '';

  // 提示信息
  const tip = document.createElement('div');
  tip.style.fontSize = '0.8rem';
  tip.style.color = '#9ca3af';
  tip.textContent = '当前表单以 Chat Completions messages 格式为主，如需使用 Responses API input 字段，请切换到 JSON 模式。';
  formContainer.appendChild(tip);

  // messages 区域
  const messages = currentConfig.body?.messages || [];
  const msgDiv = document.createElement('div');
  msgDiv.innerHTML = `<h3>messages</h3>`;
  messages.forEach((m, idx) => {
    const row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = `
      <label for="msg-role-${idx}">role</label>
      <select id="msg-role-${idx}" data-msg-idx="${idx}" class="msg-role">
        <option value="system" ${m.role === 'system' ? 'selected' : ''}>system</option>
        <option value="user" ${m.role === 'user' ? 'selected' : ''}>user</option>
        <option value="assistant" ${m.role === 'assistant' ? 'selected' : ''}>assistant</option>
        <option value="tool" ${m.role === 'tool' ? 'selected' : ''}>tool</option>
      </select>
      <button type="button" class="danger small" data-msg-idx="${idx}" aria-label="删除消息">删除</button>
    `;
    const contentRow = document.createElement('div');
    contentRow.className = 'param-row';
    contentRow.innerHTML = `
      <label for="msg-content-${idx}">content</label>
      <textarea id="msg-content-${idx}" data-msg-idx="${idx}" class="msg-content" rows="2">${escapeHtml(m.content || '')}</textarea>
      <span></span>
    `;
    msgDiv.appendChild(row);
    msgDiv.appendChild(contentRow);
  });

  const addMsgBtn = document.createElement('button');
  addMsgBtn.type = 'button';
  addMsgBtn.textContent = '+ 添加消息';
  addMsgBtn.addEventListener('click', () => {
    currentConfig.body.messages.push({ role: 'user', content: '' });
    renderFormMode();
    syncFormToJson();
  });
  msgDiv.appendChild(addMsgBtn);

  formContainer.appendChild(msgDiv);

  // 常用参数
  const paramsDiv = document.createElement('div');
  paramsDiv.innerHTML = `<h3>常用参数</h3>`;

  CHAT_PARAMS.forEach(p => {
    const value = currentConfig.body?.[p.name];
    const row = document.createElement('div');
    row.className = 'param-row';

    if (p.type === 'checkbox') {
      row.innerHTML = `
        <label for="param-${p.name}">${p.name}</label>
        <input id="param-${p.name}" type="checkbox" data-param="${p.name}" ${value ? 'checked' : ''}>
        <span></span>
      `;
    } else {
      const inputType = p.type === 'number' ? 'number' : 'text';
      const val = value ?? p.default ?? '';
      row.innerHTML = `
        <label for="param-${p.name}">${p.name}</label>
        <input id="param-${p.name}" type="${inputType}" data-param="${p.name}" value="${escapeHtml(String(val))}" 
               min="${p.min ?? ''}" max="${p.max ?? ''}" step="${p.step ?? ''}" placeholder="${p.placeholder || ''}…"
               autocomplete="off" spellcheck="false">
        <span></span>
      `;
    }
    paramsDiv.appendChild(row);
  });

  formContainer.appendChild(paramsDiv);

  // 自定义参数
  const customDiv = document.createElement('div');
  customDiv.innerHTML = `<h3>自定义参数</h3>`;
  currentConfig.customParams.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = `
      <input type="text" value="${escapeHtml(p.key)}" data-custom-idx="${idx}" class="custom-key" placeholder="参数名…" aria-label="自定义参数名" spellcheck="false" autocomplete="off">
      <input type="text" value="${escapeHtml(String(p.value))}" data-custom-idx="${idx}" class="custom-value" placeholder="参数值（JSON 字符串或普通文本）…" aria-label="自定义参数值" spellcheck="false" autocomplete="off">
      <button type="button" class="danger small" data-custom-idx="${idx}" aria-label="删除自定义参数">删除</button>
    `;
    customDiv.appendChild(row);
  });
  formContainer.appendChild(customDiv);
}

// 从表单同步到 currentConfig.body
function syncFormToConfig() {
  // messages
  const roles = document.querySelectorAll('.msg-role');
  const contents = document.querySelectorAll('.msg-content');
  currentConfig.body.messages = Array.from(roles).map((select, idx) => ({
    role: select.value,
    content: contents[idx].value || ''
  }));

  // 常用参数
  document.querySelectorAll('[data-param]').forEach(input => {
    const name = input.dataset.param;
    const param = CHAT_PARAMS.find(p => p.name === name);
    if (!param) return;

    let value = input.type === 'checkbox' ? input.checked : input.value;
    if (param.type === 'number' && input.value.trim() !== '') {
      value = parseFloat(input.value);
      if (isNaN(value)) value = param.default ?? 0;
    }

    currentConfig.body[name] = value;
  });

  // 自定义参数
  currentConfig.customParams = Array.from(document.querySelectorAll('.custom-key')).map((input, idx) => {
    const key = input.value.trim();
    const valInput = document.querySelectorAll('.custom-value')[idx];
    let value = valInput.value.trim();
    if (!key) return null;

    // 尝试解析 JSON，如果失败则当作字符串
    try {
      value = JSON.parse(value);
    } catch (e) {
      // 保持字符串
    }
    return { key, value };
  }).filter(Boolean);
}

// 将当前配置序列化为 JSON 文本
function configToJson() {
  syncFormToConfig();
  const body = deepClone(currentConfig.body);

  // 将自定义参数合并到 body
  currentConfig.customParams.forEach(p => {
    body[p.key] = p.value;
  });

  return JSON.stringify(body, null, 2);
}

// 从 JSON 文本反序列化到 currentConfig
function jsonToConfig(json) {
  try {
    const body = JSON.parse(json);
    currentConfig.body = body;
    currentConfig.customParams = [];

    // 提取 messages（如果有）
    if (!body.messages && Array.isArray(body.input)) {
      // Responses API 风格，暂不解析 input，保持 JSON 模式
    }

    renderFormMode();
    jsonError.textContent = '';
    return true;
  } catch (e) {
    jsonError.textContent = 'JSON 解析错误：' + e.message + '，请检查括号、引号是否匹配';
    return false;
  }
}

// 同步表单到 JSON 编辑器
function syncFormToJson() {
  if (!currentConfig.jsonMode) return;
  requestJson.value = configToJson();
}

// 同步 JSON 编辑器到表单（由用户手动触发）
function syncJsonToForm() {
  const json = requestJson.value;
  if (jsonToConfig(json)) {
    currentConfig.jsonMode = false;
    formMode.style.display = '';
    jsonMode.style.display = 'none';
    setActiveTab(formMode.querySelector('.tab'), formMode.parentElement);
  }
}

// 切换表单/JSON 模式
function switchMode(mode) {
  currentConfig.jsonMode = mode === 'json';
  formMode.style.display = currentConfig.jsonMode ? 'none' : '';
  jsonMode.style.display = currentConfig.jsonMode ? '' : 'none';
  if (currentConfig.jsonMode) {
    syncFormToJson();
  }
}

// 设置激活标签页
function setActiveTab(tab, bar) {
  if (!tab || !bar) return;
  bar.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
}

// 构建最终请求参数
function buildRequestParams() {
  syncFormToConfig();

  const base = baseUrlInput.value.trim().replace(/\/+$/, '');
  const path = endpointPathInput.value.trim().replace(/^\/+/, '/');
  const url = base + path;

  const headers = {};
  currentConfig.headers.forEach(h => {
    if (h.key) headers[h.key] = h.value;
  });

  const body = currentConfig.jsonMode
    ? requestJson.value
    : configToJson();

  return {
    url,
    method: httpMethodSelect.value,
    headers,
    body: (httpMethodSelect.value === 'POST' || httpMethodSelect.value === 'PUT') ? body : undefined
  };
}

// 显示 toast 提示
function showToast(message, type = 'info') {
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// 发送请求
async function sendRequest() {
  const params = buildRequestParams();
  if (!params.url) {
    showToast('请先填写 Base URL 和端点路径', 'error');
    return;
  }

  abortController = new AbortController();
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<span class="spinner"></span>请求中…';
  abortBtn.disabled = false;
  requestStartTime = Date.now();
  streamingResponse = '';
  responseContainer.innerHTML = '';
  httpStatusSpan.textContent = '-';
  durationSpan.textContent = '-';

  const options = {
    method: params.method,
    headers: params.headers,
    body: params.body,
    signal: abortController.signal
  };

  try {
    const response = await fetch(params.url, options);
    const httpStatus = response.status;
    httpStatusSpan.textContent = httpStatus;

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const isSse = contentType.includes('text/event-stream');

    if (isSse) {
      await handleSseResponse(response);
    } else if (isJson) {
      const json = await response.json();
      renderResponse(json);
    } else if (contentType.includes('image/')) {
      const blob = await response.blob();
      renderBlobResponse(blob, contentType);
    } else if (contentType.includes('audio/')) {
      const blob = await response.blob();
      renderBlobResponse(blob, contentType);
    } else if (contentType.includes('video/')) {
      const blob = await response.blob();
      renderBlobResponse(blob, contentType);
    } else {
      const text = await response.text();
      renderTextResponse(text, contentType);
    }

    const duration = Date.now() - requestStartTime;
    durationSpan.textContent = duration + ' ms';

    addHistory(params, httpStatus, duration);
  } catch (err) {
    if (err.name === 'AbortError') {
      showToast('请求已中止', 'info');
    } else {
      showToast('请求失败：' + err.message, 'error');
    }
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = '发送请求';
    abortBtn.disabled = true;
    abortController = null;
  }
}

// 处理 SSE 流式响应（兼容 Chat Completions / Responses）
async function handleSseResponse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\n\n/);
    buffer = lines.pop(); // 最后一段可能不完整

    for (const chunk of lines) {
      if (!chunk.startsWith('data: ')) continue;
      const data = chunk.replace(/^data: /, '');
      if (data === '[DONE]') continue;

      try {
        const event = JSON.parse(data);
        // Chat Completions: object = chat.completion.chunk
        // Responses: object 可能不同，这里统一尝试取 choices[0].delta.content 或 output[0].content[0].text
        if (event.choices && event.choices[0]?.delta?.content) {
          fullContent += event.choices[0].delta.content;
        } else if (event.output && event.output[0]?.content?.[0]?.text) {
          fullContent += event.output[0].content[0].text;
        }
        renderStreamingText(fullContent);
      } catch (e) {
        // 忽略解析错误
      }
    }
  }

  // 流结束，重新渲染最终结果
  renderTextResponse(fullContent, 'text/plain');
}

// 渲染流式文本（逐步追加）
function renderStreamingText(text) {
  responseContainer.innerHTML = '';
  const pre = document.createElement('pre');
  pre.style.whiteSpace = 'pre-wrap';
  pre.textContent = text;
  responseContainer.appendChild(pre);
}

// 渲染最终响应（JSON / 文本 / 二进制）
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

// 历史记录相关
function addHistory(params, httpStatus, duration) {
  const item = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    method: params.method,
    url: params.url,
    httpStatus,
    duration,
    headers: params.headers,
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
  history.forEach(item => {
    const li = document.createElement('li');
    li.dataset.id = item.id;
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.setAttribute('aria-label', `${item.method} ${item.httpStatus} ${item.url}`);
    li.innerHTML = `
      <div class="history-meta">
        <span>${dtFormat.format(new Date(item.timestamp))}</span>
        <span>${item.method} ${item.httpStatus} ${item.duration}ms</span>
      </div>
      <div class="history-url">${escapeHtml(item.url)}</div>
    `;
    historyList.appendChild(li);
  });
}

function loadHistoryToConfig(id) {
  const item = history.find(h => h.id === id);
  if (!item) return;

  // 解析 URL 回 baseUrl + endpointPath
  const url = new URL(item.url);
  const baseUrl = url.origin + url.pathname.replace(/\/[^/]+$/, '');
  const endpointPath = url.pathname.replace(baseUrl.replace(url.origin, ''), '') || '/';

  baseUrlInput.value = baseUrl;
  endpointPathInput.value = endpointPath;
  httpMethodSelect.value = item.method;

  // 还原 headers
  currentConfig.headers = Object.entries(item.headers).map(([key, value]) => ({ key, value }));
  renderHeaders();

  // 还原 body
  try {
    const body = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
    currentConfig.body = body;
    currentConfig.customParams = [];
    currentConfig.jsonMode = false;
    renderFormMode();
    requestJson.value = JSON.stringify(body, null, 2);
  } catch (e) {
    showToast('历史配置加载失败：' + e.message + '，请尝试手动填写参数', 'error');
  }

  updateFinalUrl();
}

// 从 URL 参数恢复配置（方便分享配置）
function restoreFromUrlParams() {
  const params = new URLSearchParams(location.search);
  const config = params.get('config');
  if (!config) return;
  try {
    const decoded = JSON.parse(decodeURIComponent(config));
    if (decoded.baseUrl) baseUrlInput.value = decoded.baseUrl;
    if (decoded.endpointPath) endpointPathInput.value = decoded.endpointPath;
    if (decoded.headers) currentConfig.headers = decoded.headers;
    if (decoded.body) {
      currentConfig.body = decoded.body;
      currentConfig.customParams = decoded.customParams || [];
      currentConfig.jsonMode = false;
      renderFormMode();
      requestJson.value = JSON.stringify(decoded.body, null, 2);
    }
    renderHeaders();
    updateFinalUrl();
  } catch (e) {
    // 忽略
  }
}

// 绑定事件
function bindEvents() {
  // 端点变更
  baseUrlInput.addEventListener('input', updateFinalUrl);
  endpointPathInput.addEventListener('input', updateFinalUrl);
  httpMethodSelect.addEventListener('change', updateFinalUrl);

  // 请求头增删
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

  // 模式切换
  tabBars.forEach(bar => {
    bar.addEventListener('click', e => {
      if (e.target.matches('.tab')) {
        const mode = e.target.dataset.mode;
        const view = e.target.dataset.view;
        if (mode) switchMode(mode);
        if (view) switchView(view);
        setActiveTab(e.target, bar);
      }
    });
  });

  // 表单同步到 JSON
  formContainer.addEventListener('input', () => {
    syncFormToJson();
  });

  // 添加自定义参数
  addParamBtn.addEventListener('click', () => {
    currentConfig.customParams.push({ key: '', value: '' });
    renderFormMode();
    syncFormToJson();
  });

  // 删除自定义参数 / 消息
  formContainer.addEventListener('click', e => {
    if (e.target.matches('.danger')) {
      const idx = +e.target.dataset.idx ?? e.target.dataset.customIdx ?? e.target.dataset.msgIdx;
      if (e.target.dataset.customIdx !== undefined) {
        currentConfig.customParams.splice(idx, 1);
      } else if (e.target.dataset.msgIdx !== undefined) {
        currentConfig.body.messages.splice(idx, 1);
      }
      renderFormMode();
      syncFormToJson();
    }
  });

  // JSON 编辑器
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

  requestJson.addEventListener('input', () => {
    // 可选：自动防抖解析，这里用按钮触发
  });

  // 发送 / 中止
  sendBtn.addEventListener('click', sendRequest);
  abortBtn.addEventListener('click', () => {
    if (abortController) abortController.abort();
  });

  // 历史记录
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

  clearHistoryBtn.addEventListener('click', () => {
    showConfirm('确定要清空所有历史记录吗？此操作不可撤销。', () => {
      history = [];
      saveHistory(history);
      renderHistory();
    });
  });

  exportHistoryBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'openai_debugger_history.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // 响应视图切换（智能预览 / 原始）
  function switchView(view) {
    // 这里简单实现：智能预览就是当前渲染结果，原始文本额外加一个原始区域
    // 如需更复杂可扩展
  }
}

function showConfirm(message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'confirm-title');
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <h3 id="confirm-title" class="confirm-title">确认操作</h3>
      <p>${escapeHtml(message)}</p>
      <div class="confirm-actions">
        <button type="button" class="confirm-cancel">取消</button>
        <button type="button" class="danger confirm-ok">确认</button>
      </div>
    </div>
  `;
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
