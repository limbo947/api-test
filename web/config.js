// config.js – 默认配置与工具函数 (优化版 v2)
// 修复内容：
// 1. 统一使用 const/let 替代 var
// 2. encryptValue/decryptValue 重命名为 obfuscateValue/deobfuscateValue
// 3. 提取公共工具函数（retryableFetch、parseSseStream、createSpinner、buildConfigData）
// 4. 添加 JSDoc 注释
// 5. 缓存淘汰改用 LRU 策略（Map 迭代顺序保持插入顺序）
;(function () {
  'use strict';

  const SENSITIVE_HEADER_KEYS = new Set([
    'authorization', 'api-key', 'x-api-key',
    'cookie', 'set-cookie', 'proxy-authorization'
  ]);

  const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
  const DEFAULT_ENDPOINT = '';
  const PLACEHOLDER_API_KEY = 'YOUR_API_KEY';

  const DEFAULT_HEADERS = [
    { key: 'Authorization', value: 'Bearer ' + PLACEHOLDER_API_KEY },
    { key: 'Content-Type', value: 'application/json' }
  ];

  const MAX_HISTORY_ITEMS = 20;
  const FETCH_MODELS_TIMEOUT_MS = 10000;
  const TOAST_DISPLAY_MS = 3000;
  const JSON_SYNC_DELAY_MS = 500;
  const JSON_PREVIEW_DELAY_MS = 300;
  const FETCH_MODELS_DEBOUNCE_MS = 1500;

  const MAX_UPLOAD_FILE_SIZE_MB = 20;
  const MAX_UPLOAD_TOTAL_SIZE_MB = 50;

  const CACHE_TTL_MS = 5 * 60 * 1000;
  const CACHE_MAX_ENTRIES = 50;
  const CHAT_REQUEST_TIMEOUT_MS = 120000;
  const CHAT_MAX_RETRIES = 2;
  const REQUEST_DEDUP_WINDOW_MS = 100;

  const ENDPOINT_TEMPLATES = {
    'chat/completions': {
      params: [
        { name: 'model', type: 'text', placeholder: '模型 ID，如 gpt-4o、o3-mini', description: '使用的模型 ID', datalist: 'modelDatalist' },
        { name: 'stream', type: 'select', options: [true, false], default: false, placeholder: '是否流式', description: '是否启用流式响应（Server-Sent Events）' }
      ],
      body: {
        model: '',
        messages: [
          { role: 'system', content: '你是一个有帮助的助手。' },
          { role: 'user', content: '' }
        ],
        stream: false
      },
      hasMessages: true
    },
    'responses': {
      params: [
        { name: 'model', type: 'text', placeholder: '模型 ID，如 gpt-4o、o3-mini', description: '使用的模型 ID', datalist: 'modelDatalist' },
        { name: 'stream', type: 'select', options: [true, false], default: false, placeholder: '是否流式', description: '是否启用流式响应（Server-Sent Events）' }
      ],
      body: {
        model: '',
        input: '',
        stream: false
      },
      hasMessages: false
    },
    'embeddings': {
      params: [
        { name: 'model', type: 'text', placeholder: '嵌入模型 ID', description: '使用的嵌入模型 ID，如 text-embedding-3-small', datalist: 'modelDatalist' }
      ],
      body: {
        model: 'text-embedding-3-small',
        input: ''
      },
      hasMessages: false
    },
    'images/generations': {
      params: [
        { name: 'model', type: 'text', placeholder: '图像模型 ID', description: '使用的图像生成模型，如 dall-e-3', datalist: 'modelDatalist' }
      ],
      body: {
        model: 'dall-e-3',
        prompt: ''
      },
      hasMessages: false
    },
    'audio/transcriptions': {
      params: [
        { name: 'model', type: 'text', placeholder: '音频模型 ID', description: '使用的音频转录模型，如 whisper-1', datalist: 'modelDatalist' }
      ],
      body: {
        model: 'whisper-1'
      },
      hasMessages: false
    },
    'audio/translations': {
      params: [
        { name: 'model', type: 'text', placeholder: '音频模型 ID', description: '使用的音频翻译模型，如 whisper-1', datalist: 'modelDatalist' }
      ],
      body: {
        model: 'whisper-1'
      },
      hasMessages: false
    },
    'audio/speech': {
      params: [
        { name: 'model', type: 'text', placeholder: '语音模型 ID', description: '使用的语音合成模型，如 tts-1', datalist: 'modelDatalist' }
      ],
      body: {
        model: 'tts-1',
        input: ''
      },
      hasMessages: false
    },
    'models': {
      params: [],
      body: {},
      hasMessages: false
    }
  };

  /**
   * 根据端点路径获取预设参数定义
   * @param {string} endpointPath
   * @returns {Array<{name: string, type: string, placeholder?: string, description?: string}>}
   */
  function getEndpointParams(endpointPath) {
    const normalized = normalizeEndpointPath(endpointPath);
    const template = ENDPOINT_TEMPLATES[normalized];
    return template ? template.params : ENDPOINT_TEMPLATES['chat/completions'].params;
  }

  /**
   * 根据端点路径获取默认请求体
   * @param {string} endpointPath
   * @returns {object}
   */
  function getEndpointDefaultBody(endpointPath) {
    const normalized = normalizeEndpointPath(endpointPath);
    const template = ENDPOINT_TEMPLATES[normalized];
    return template ? deepClone(template.body) : deepClone(ENDPOINT_TEMPLATES['chat/completions'].body);
  }

  /**
   * 判断端点是否使用 messages 结构
   * @param {string} endpointPath
   * @returns {boolean}
   */
  function endpointHasMessages(endpointPath) {
    const normalized = normalizeEndpointPath(endpointPath);
    const template = ENDPOINT_TEMPLATES[normalized];
    return template ? template.hasMessages : true;
  }

  const CUSTOM_PARAM_PRESETS = [
    { key: 'temperature', value: '1.0', description: '控制输出随机性，范围 0.0-2.0（建议与 top_p 二选一）' },
    { key: 'max_completion_tokens', value: '4096', description: '生成的最大 token 数（推荐，替代已弃用的 max_tokens）' },
    { key: 'max_tokens', value: '4096', description: '生成的最大 token 数（已弃用，请优先使用 max_completion_tokens）' },
    { key: 'top_p', value: '1.0', description: '核采样阈值，范围 0.0-1.0（建议与 temperature 二选一）' },
    { key: 'presence_penalty', value: '0.0', description: '存在惩罚，范围 -2.0 至 2.0' },
    { key: 'frequency_penalty', value: '0.0', description: '频率惩罚，范围 -2.0 至 2.0' },
    { key: 'stop', value: '', description: '停止序列，最多 4 个，多个用逗号分隔' },
    { key: 'n', value: '1', description: '为每个输入生成的补全选项数量' },
    { key: 'seed', value: '', description: '用于可重复输出的随机种子（Beta 功能）' },
    { key: 'user', value: '', description: '代表终端用户的唯一标识符，用于监控和滥用检测' },
    { key: 'store', value: 'false', description: '是否存储响应以供后续检索' },
    { key: 'service_tier', value: 'auto', description: '服务层级：auto 或 default' },
    { key: 'parallel_tool_calls', value: 'true', description: '是否允许并行调用多个工具' },
    { key: 'logit_bias', value: '{}', description: '修改指定 token 在生成结果中出现的概率' },
    { key: 'input', value: '', description: 'Responses API 用户输入（替代 messages）' },
    { key: 'instructions', value: '', description: '系统指令（类比 system prompt）' },
    { key: 'max_output_tokens', value: '4096', description: 'Responses API 生成的最大 token 数' },
    { key: 'previous_response_id', value: '', description: '用于延续之前的对话状态（有状态会话）' },
    { key: 'reasoning', value: '{"effort": "medium"}', description: '思考模式配置，effort 可选 low/medium/high（仅 o1/o3 系列）' },
    { key: 'dimensions', value: '', description: '嵌入向量的输出维度（仅部分模型支持）' },
    { key: 'encoding_format', value: 'float', description: '返回的嵌入向量编码格式：float 或 base64' },
    { key: 'prompt', value: '', description: '生成图像的文本描述（必填）' },
    { key: 'size', value: '1024x1024', description: '生成图像的尺寸' },
    { key: 'quality', value: 'standard', description: '图像质量：standard 或 hd（仅 dall-e-3）' },
    { key: 'style', value: 'vivid', description: '图像风格：vivid 或 natural（仅 dall-e-3）' },
    { key: 'voice', value: 'alloy', description: '语音音色' },
    { key: 'response_format', value: 'mp3', description: '输出格式（音频/图像/转录通用）' },
    { key: 'speed', value: '1.0', description: '语速倍数，范围 0.25-4.0' },
    { key: 'language', value: 'zh', description: '输入音频的语言（ISO-639-1 代码）' },
    { key: 'metadata', value: '{}', description: '最多 16 个键值对的自定义元数据对象' },
    { key: 'tools', value: '[]', description: '模型可调用的工具列表（如 web_search、file_search）' },
    { key: 'tool_choice', value: 'auto', description: '控制模型是否调用工具：auto/none/required 或指定工具' },
    { key: 'modalities', value: '["text"]', description: '指定输出模态，如 ["text"] 或 ["text", "audio"]' },
    { key: 'stream_options', value: '{"include_usage": true}', description: '流式响应附加选项，如 include_usage' },
    { key: 'prediction', value: '{"type": "content", "content": ""}', description: '预测输出，用于加速重复内容生成' },
    { key: 'audio', value: '{"voice": "alloy", "format": "mp3"}', description: '语音输出配置，用于多模态文本+语音响应' },
    { key: 'web_search', value: '{"search_context_size": "medium"}', description: 'Web 搜索工具配置（仅支持搜索的模型）' },
    { key: 'tool_resources', value: '{}', description: '工具资源配置，如 file_search 的向量存储' },
    { key: 'truncation', value: '{"type": "auto"}', description: '截断策略：auto 或 disabled（用于长对话）' }
  ];

  /**
   * 验证参数值
   * @param {string} paramName
   * @param {*} value
   * @param {{type: string, min?: number, max?: number, options?: Array}} paramDef
   * @returns {{valid: boolean, error?: string, warning?: string}}
   */
  function validateParamValue(paramName, value, paramDef) {
    if (!paramDef) return { valid: true };

    if (paramDef.type === 'number') {
      const num = parseFloat(value);
      if (isNaN(num)) {
        return { valid: false, error: paramName + ' 必须是数字' };
      }
      if (paramDef.min !== undefined && num < paramDef.min) {
        return { valid: false, error: paramName + ' 不能小于 ' + paramDef.min };
      }
      if (paramDef.max !== undefined && num > paramDef.max) {
        return { valid: false, error: paramName + ' 不能大于 ' + paramDef.max };
      }
    }

    if (paramDef.type === 'select' && value && paramDef.options && !paramDef.options.includes(value)) {
      return { valid: true, warning: paramName + ' 的值 "' + value + '" 不在预设选项中' };
    }

    return { valid: true };
  }

  /**
   * 判断请求头是否包含敏感信息
   * @param {string} key
   * @returns {boolean}
   */
  function isSensitiveHeader(key) {
    return SENSITIVE_HEADER_KEYS.has(key.toLowerCase());
  }

  /**
   * 判断值是否为占位符 API Key
   * @param {string} value
   * @returns {boolean}
   */
  function isPlaceholderApiKey(value) {
    if (!value) return false;
    return value === PLACEHOLDER_API_KEY ||
           value === 'Bearer ' + PLACEHOLDER_API_KEY ||
           value.indexOf(PLACEHOLDER_API_KEY) !== -1;
  }

  /**
   * 对敏感值进行脱敏处理（保留前后各4位）
   * @param {string} key
   * @param {string} value
   * @returns {string}
   */
  function maskSensitiveValue(key, value) {
    if (!isSensitiveHeader(key) || !value) return value;
    const spaceIdx = value.indexOf(' ');
    if (spaceIdx > 0) {
      const prefix = value.substring(0, spaceIdx + 1);
      const secret = value.substring(spaceIdx + 1);
      if (secret.length <= 8) return prefix + '****';
      return prefix + secret.substring(0, 4) + '****' + secret.substring(secret.length - 4);
    }
    if (value.length <= 8) return '****';
    return value.substring(0, 4) + '****' + value.substring(value.length - 4);
  }

  /**
   * 创建默认配置对象
   * @returns {{baseUrl: string, endpointPath: string, httpMethod: string, headers: Array, body: object, customParams: Array}}
   */
  function createDefaultConfig() {
    return {
      baseUrl: DEFAULT_BASE_URL,
      endpointPath: DEFAULT_ENDPOINT,
      httpMethod: 'POST',
      headers: DEFAULT_HEADERS.map(function (h) { return { key: h.key, value: h.value }; }),
      body: deepClone(ENDPOINT_TEMPLATES['chat/completions'].body),
      customParams: [
        { key: 'temperature', value: '1.0' },
        { key: 'max_completion_tokens', value: '4096' },
        { key: 'top_p', value: '1.0' },
        { key: 'presence_penalty', value: '0.0' },
        { key: 'frequency_penalty', value: '0.0' }
      ]
    };
  }

  /**
   * 检查 localStorage 是否可用
   * @returns {boolean}
   */
  function isLocalStorageAvailable() {
    try {
      const testKey = '__storage_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 安全地从 localStorage 读取并解析 JSON
   * @param {string} key
   * @returns {*|null}
   */
  function safeGetLocalStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw || raw.trim() === '') return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('读取 localStorage 失败 (' + key + ')：', e.message);
      return null;
    }
  }

  /**
   * 安全地向 localStorage 写入 JSON
   * @param {string} key
   * @param {*} value
   * @returns {boolean}
   */
  function safeSetLocalStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('写入 localStorage 失败 (' + key + ')：', e.message);
      return false;
    }
  }

  const CONFIG_STORAGE_KEY = 'openai_debugger_saved_configs';
  const HISTORY_STORAGE_KEY = 'openai_debugger_history';

  /**
   * 加载请求历史记录
   * @returns {Array}
   */
  function loadHistory() {
    return safeGetLocalStorage(HISTORY_STORAGE_KEY) || [];
  }

  /**
   * 保存请求历史记录
   * @param {Array} history
   */
  function saveHistory(history) {
    if (!safeSetLocalStorage(HISTORY_STORAGE_KEY, history)) {
      if (typeof showToast === 'function') {
        showToast('保存历史记录失败：浏览器存储不可用', 'error');
      }
    }
  }

  /**
   * 加载已保存的配置列表，自动解密敏感头
   * @returns {Array}
   */
  function loadSavedConfigs() {
    const configs = safeGetLocalStorage(CONFIG_STORAGE_KEY) || [];
    return configs.map(function (cfg) {
      if (cfg.headers && Array.isArray(cfg.headers)) {
        cfg.headers = cfg.headers.map(function (h) {
          if (isSensitiveHeader(h.key) && typeof h.value === 'string') {
            return { key: h.key, value: deobfuscateValue(h.value) };
          }
          return h;
        });
      }
      return cfg;
    });
  }

  /**
   * 保存配置列表，自动混淆敏感头
   * @param {Array} configs
   */
  function saveSavedConfigs(configs) {
    const toSave = configs.map(function (cfg) {
      const cloned = deepClone(cfg);
      if (cloned.headers && Array.isArray(cloned.headers)) {
        cloned.headers = cloned.headers.map(function (h) {
          if (isSensitiveHeader(h.key) && typeof h.value === 'string') {
            return { key: h.key, value: obfuscateValue(h.value) };
          }
          return h;
        });
      }
      return cloned;
    });
    if (!safeSetLocalStorage(CONFIG_STORAGE_KEY, toSave)) {
      if (typeof showToast === 'function') {
        showToast('保存配置失败：浏览器存储不可用', 'error');
      }
    }
  }

  /**
   * 保存单个配置
   * @param {string} name
   * @param {object} configData
   * @returns {'新建'|'覆盖'}
   */
  function saveConfig(name, configData) {
    const configs = loadSavedConfigs();
    const existingIndex = configs.findIndex(function (c) { return c.name === name; });
    const configToSave = {};
    Object.keys(configData).forEach(function (k) {
      configToSave[k] = deepClone(configData[k]);
    });
    configToSave.name = name;
    configToSave.savedAt = new Date().toISOString();
    if (existingIndex >= 0) {
      configs[existingIndex] = configToSave;
    } else {
      configs.push(configToSave);
    }
    saveSavedConfigs(configs);
    return existingIndex >= 0 ? '覆盖' : '新建';
  }

  /**
   * 删除指定名称的配置
   * @param {string} name
   */
  function deleteConfig(name) {
    const configs = loadSavedConfigs();
    const filtered = configs.filter(function (c) { return c.name !== name; });
    saveSavedConfigs(filtered);
  }

  /**
   * 根据名称获取配置
   * @param {string} name
   * @returns {object|undefined}
   */
  function getConfigByName(name) {
    const configs = loadSavedConfigs();
    return configs.find(function (c) { return c.name === name; });
  }

  /**
   * 深度克隆对象（优先使用 structuredClone，回退到 JSON）
   * @param {*} obj
   * @returns {*}
   */
  function deepClone(obj) {
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(obj);
      } catch (e) {
        // structuredClone 失败时回退到 JSON 方式
      }
    }
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * 构建端点选择框的选项 DOM
   * @returns {DocumentFragment}
   */
  function buildEndpointSelectOptions() {
    const endpointLabels = {
      'chat/completions': 'chat/completions (聊天补全)',
      'responses': 'responses (统一响应)',
      'embeddings': 'embeddings (文本嵌入)',
      'images/generations': 'images/generations (图像生成)',
      'audio/transcriptions': 'audio/transcriptions (音频转录)',
      'audio/translations': 'audio/translations (音频翻译)',
      'audio/speech': 'audio/speech (文本转语音)',
      'models': 'models (列出模型)'
    };

    const fragment = document.createDocumentFragment();
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.selected = true;
    defaultOption.textContent = '-- 选择预设端点 --';
    fragment.appendChild(defaultOption);

    Object.keys(ENDPOINT_TEMPLATES).forEach(function (path) {
      const option = document.createElement('option');
      option.value = path;
      option.textContent = endpointLabels[path] || path;
      fragment.appendChild(option);
    });

    const customOption = document.createElement('option');
    customOption.value = 'custom';
    customOption.textContent = '自定义路径...';
    fragment.appendChild(customOption);

    return fragment;
  }

  /**
   * 从请求体中提取预设参数
   * @param {object} body
   * @param {string} endpointPath
   * @param {Array} existingCustomParams
   * @returns {{body: object, customParams: Array}}
   */
  function extractPresetParamsFromBody(body, endpointPath, existingCustomParams) {
    if (!body || typeof body !== 'object') return { body: body, customParams: existingCustomParams || [] };

    const presetKeys = {};
    CUSTOM_PARAM_PRESETS.forEach(function (p) { presetKeys[p.key] = p; });

    const endpointParamNames = {};
    getEndpointParams(endpointPath).forEach(function (p) { endpointParamNames[p.name] = true; });

    const reservedKeys = { model: true, messages: true, stream: true, input: true };
    Object.keys(ENDPOINT_TEMPLATES).forEach(function (ep) {
      const tpl = ENDPOINT_TEMPLATES[ep];
      if (tpl.body) Object.keys(tpl.body).forEach(function (k) { reservedKeys[k] = true; });
    });

    const existingKeys = {};
    (existingCustomParams || []).forEach(function (p) { existingKeys[p.key] = true; });

    const newCustomParams = (existingCustomParams || []).slice();
    const newBody = deepClone(body);

    Object.keys(body).forEach(function (key) {
      if (reservedKeys[key] || endpointParamNames[key] || existingKeys[key]) return;
      if (presetKeys[key]) {
        newCustomParams.push({ key: key, value: body[key] });
        delete newBody[key];
      }
    });

    return { body: newBody, customParams: newCustomParams };
  }

  // ==================== 数据混淆（非加密，用于本地存储防明文泄露） ====================
  // 注意：这不是真正的加密，只是防止明文存储。真正的安全需要后端支持。

  let _obfuscationKey = null;

  /**
   * 生成基于 hostname 的混淆密钥
   * @returns {string}
   */
  function getObfuscationKey() {
    if (_obfuscationKey) return _obfuscationKey;
    const host = typeof location !== 'undefined' ? location.hostname : 'default';
    const keyStr = 'openai-debugger-v2-' + host;
    let hash = 0;
    for (let i = 0; i < keyStr.length; i++) {
      const char = keyStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    _obfuscationKey = Math.abs(hash).toString(36);
    return _obfuscationKey;
  }

  /**
   * 混淆敏感值（非加密，仅防本地明文泄露）
   * @param {string} str
   * @returns {string}
   */
  function obfuscateValue(str) {
    if (typeof str !== 'string' || str.indexOf('enc:') === 0) return str;
    try {
      const key = getObfuscationKey();
      let result = '';
      for (let i = 0; i < str.length; i++) {
        const keyChar = key.charCodeAt(i % key.length);
        const charCode = str.charCodeAt(i);
        const encoded = (charCode + keyChar + i) % 65536;
        result += String.fromCharCode(encoded);
      }
      return 'enc:' + btoa(unescape(encodeURIComponent(result)));
    } catch (e) {
      console.warn('混淆失败，回退到明文:', e.message);
      return str;
    }
  }

  /**
   * 反混淆值
   * @param {string} str
   * @returns {string}
   */
  function deobfuscateValue(str) {
    if (typeof str !== 'string' || str.indexOf('enc:') !== 0) return str;
    try {
      const key = getObfuscationKey();
      const encoded = decodeURIComponent(escape(atob(str.substring(4))));
      let result = '';
      for (let i = 0; i < encoded.length; i++) {
        const keyChar = key.charCodeAt(i % key.length);
        const charCode = encoded.charCodeAt(i);
        const decoded = (charCode - keyChar - i + 65536) % 65536;
        result += String.fromCharCode(decoded);
      }
      return result;
    } catch (e) {
      console.warn('反混淆失败，返回原值:', e.message);
      return str;
    }
  }

  // ==================== 请求缓存（使用 Map 保持插入顺序，实现 LRU） ====================

  const _requestCache = new Map();
  const _pendingRequests = new Map();

  /**
   * 生成缓存键
   * @param {string} url
   * @param {string} method
   * @param {*} body
   * @returns {string}
   */
  function getCacheKey(url, method, body) {
    const parts = [method || 'GET', url];
    if (body) parts.push(typeof body === 'string' ? body : JSON.stringify(body));
    return parts.join('||');
  }

  /**
   * 从缓存获取响应
   * @param {string} key
   * @returns {*|null}
   */
  function getCachedResponse(key) {
    if (!_requestCache.has(key)) return null;
    const entry = _requestCache.get(key);
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      _requestCache.delete(key);
      return null;
    }
    // LRU: 将访问的条目移到末尾
    _requestCache.delete(key);
    _requestCache.set(key, entry);
    return entry.data;
  }

  /**
   * 设置缓存响应（LRU 淘汰策略）
   * @param {string} key
   * @param {*} data
   */
  function setCachedResponse(key, data) {
    // Map 保持插入顺序，删除最早的条目
    if (_requestCache.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = _requestCache.keys().next().value;
      if (oldestKey) _requestCache.delete(oldestKey);
    }
    _requestCache.set(key, { data: data, timestamp: Date.now() });
  }

  /**
   * 清除缓存
   * @param {string} [key] 不传则清空全部
   */
  function invalidateCache(key) {
    if (key) {
      _requestCache.delete(key);
    } else {
      _requestCache.clear();
    }
  }

  function getPendingRequest(key) {
    return _pendingRequests.get(key) || null;
  }

  function setPendingRequest(key, promise) {
    _pendingRequests.set(key, promise);
  }

  function removePendingRequest(key) {
    _pendingRequests.delete(key);
  }

  /**
   * 移除对象中的空值
   * @param {object} body
   * @returns {object}
   */
  function stripEmptyValues(body) {
    if (!body || typeof body !== 'object') return body;
    const result = {};
    const keys = Object.keys(body);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = body[key];
      if (value === undefined) continue;
      if (value === null) continue;
      if (value === '') continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      result[key] = value;
    }
    return result;
  }

  /**
   * 构建紧凑的请求体 JSON
   * @param {object} body
   * @returns {string}
   */
  function buildCompactBody(body) {
    const cleaned = stripEmptyValues(body);
    return JSON.stringify(cleaned);
  }

  // ==================== API Key 管理 ====================

  const API_KEY_STORE_KEY = 'openai_debugger_api_keys';
  let _apiKeyCache = null;
  let _apiKeyCacheTimestamp = 0;
  const API_KEY_CACHE_TTL_MS = 30000;

  /**
   * 加载密钥存储（带内存缓存）
   * @returns {{keys: Array, activeKeyId: string|null}}
   */
  function loadApiKeyStore() {
    const now = Date.now();
    if (_apiKeyCache && (now - _apiKeyCacheTimestamp) < API_KEY_CACHE_TTL_MS) {
      return _apiKeyCache;
    }
    const raw = safeGetLocalStorage(API_KEY_STORE_KEY);
    const store = raw || { keys: [], activeKeyId: null };
    if (!store.keys) store.keys = [];
    if (!store.activeKeyId) store.activeKeyId = null;
    _apiKeyCache = store;
    _apiKeyCacheTimestamp = now;
    return store;
  }

  function saveApiKeyStore(store) {
    _apiKeyCache = store;
    _apiKeyCacheTimestamp = Date.now();
    safeSetLocalStorage(API_KEY_STORE_KEY, store);
  }

  /**
   * 保存 API Key
   * @param {string} name
   * @param {string} rawKey
   * @param {string} provider
   * @returns {string} 生成的 key ID
   */
  function saveApiKey(name, rawKey, provider) {
    const store = loadApiKeyStore();
    const id = 'key_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const obfuscated = obfuscateValue(rawKey);
    const entry = {
      id: id,
      name: name,
      provider: provider || 'openai',
      obfuscated: obfuscated,
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    };
    store.keys.push(entry);
    if (!store.activeKeyId) store.activeKeyId = id;
    saveApiKeyStore(store);
    return id;
  }

  /**
   * 获取 API Key 明文
   * @param {string} id
   * @returns {string|null}
   */
  function getApiKey(id) {
    const store = loadApiKeyStore();
    const entry = store.keys.find(function (k) { return k.id === id; });
    if (!entry) return null;
    const decrypted = deobfuscateValue(entry.obfuscated);
    entry.lastUsedAt = new Date().toISOString();
    saveApiKeyStore(store);
    return decrypted;
  }

  /**
   * 获取当前激活的 API Key
   * @returns {string|null}
   */
  function getActiveApiKey() {
    const store = loadApiKeyStore();
    if (!store.activeKeyId) return null;
    return getApiKey(store.activeKeyId);
  }

  /**
   * 设置当前激活的 API Key
   * @param {string} id
   */
  function setActiveApiKey(id) {
    const store = loadApiKeyStore();
    const exists = store.keys.some(function (k) { return k.id === id; });
    if (exists) {
      store.activeKeyId = id;
      saveApiKeyStore(store);
    }
  }

  /**
   * 删除 API Key
   * @param {string} id
   */
  function deleteApiKey(id) {
    const store = loadApiKeyStore();
    store.keys = store.keys.filter(function (k) { return k.id !== id; });
    if (store.activeKeyId === id) {
      store.activeKeyId = store.keys.length > 0 ? store.keys[0].id : null;
    }
    saveApiKeyStore(store);
  }

  /**
   * 列出所有 API Key（显示脱敏版本）
   * @returns {Array<{id: string, name: string, provider: string, createdAt: string, lastUsedAt: string|null, masked: string}>}
   */
  function listApiKeys() {
    const store = loadApiKeyStore();
    return store.keys.map(function (k) {
      return {
        id: k.id,
        name: k.name,
        provider: k.provider,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        masked: maskApiKey(deobfuscateValue(k.obfuscated))
      };
    });
  }

  /**
   * 脱敏 API Key（保留前后4位）
   * @param {string} key
   * @returns {string}
   */
  function maskApiKey(key) {
    if (!key || typeof key !== 'string') return '';
    if (key.length <= 8) return '****';
    return key.substring(0, 4) + '****' + key.substring(key.length - 4);
  }

  /**
   * 验证 API Key 格式
   * @param {string} key
   * @returns {{valid: boolean, error?: string}}
   */
  function validateApiKey(key) {
    if (!key || typeof key !== 'string') {
      return { valid: false, error: '密钥不能为空' };
    }
    key = key.trim();
    if (key.length < 8) {
      return { valid: false, error: '密钥长度不足（至少 8 个字符）' };
    }
    if (key.indexOf(' ') >= 0) {
      return { valid: false, error: '密钥不能包含空格' };
    }
    if (/[\r\n\t]/.test(key)) {
      return { valid: false, error: '密钥不能包含换行或制表符' };
    }
    if (key === 'YOUR_API_KEY' || key === 'YOUR****_KEY') {
      return { valid: false, error: '请替换为真实的 API Key' };
    }
    return { valid: true };
  }

  /**
   * 从多个来源解析 API Key
   * @param {Array<string>} priorityList 优先级列表 ['store', 'header']
   * @param {Array} headersFallback
   * @returns {{key: string, source: string}|null}
   */
  function resolveApiKeyFromSources(priorityList, headersFallback) {
    const sources = priorityList || ['store', 'header'];
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (source === 'store') {
        const key = getActiveApiKey();
        if (key && validateApiKey(key).valid) {
          return { key: key, source: 'store' };
        }
      } else if (source === 'header' && headersFallback) {
        const authHeader = headersFallback.find(function (h) {
          return h.key && h.key.toLowerCase() === 'authorization';
        });
        if (authHeader) {
          const match = String(authHeader.value).match(/Bearer\s+(.+)/i);
          if (match) {
            const extracted = match[1].trim();
            if (validateApiKey(extracted).valid) {
              return { key: extracted, source: 'header' };
            }
          }
        }
      }
    }
    return null;
  }

  /**
   * 转义 JSON 字符串中的特殊字符
   * @param {string} str
   * @returns {string}
   */
  function escapeJsonString(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/[\b]/g, '\\b')
      .replace(/\f/g, '\\f');
  }

  /**
   * 清除配置值中的控制字符
   * @param {*} value
   * @returns {*}
   */
  function sanitizeConfigValue(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
   * 验证请求配置的完整性
   * @param {{baseUrl: string, headers: Array, body: object}} config
   * @returns {{valid: boolean, errors: Array<string>, warnings: Array<string>}}
   */
  function validateConfig(config) {
    const errors = [];
    const warnings = [];

    if (!config) {
      return { valid: false, errors: ['配置为空'], warnings: [] };
    }

    if (!config.baseUrl || typeof config.baseUrl !== 'string') {
      errors.push('Base URL 未设置或格式无效');
    } else {
      try {
        const url = new URL(config.baseUrl);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          warnings.push('Base URL 使用了非标准协议：' + url.protocol);
        }
      } catch (e) {
        errors.push('Base URL 格式无效：' + e.message);
      }
    }

    if (config.headers && Array.isArray(config.headers)) {
      const hasAuth = config.headers.some(function (h) {
        return h.key && h.key.toLowerCase() === 'authorization' && h.value;
      });
      if (!hasAuth) {
        warnings.push('未设置 Authorization 请求头，API 请求可能返回 401 错误');
      } else {
        config.headers.forEach(function (h) {
          if (h.key && isSensitiveHeader(h.key)) {
            const validation = validateApiKey(h.value.replace(/^Bearer\s+/i, ''));
            if (!validation.valid) {
              warnings.push('Authorization 密钥无效：' + validation.error);
            }
          }
        });
      }
    }

    if (config.body && typeof config.body === 'object') {
      if (!config.body.model && config.body.messages) {
        warnings.push('请求体中未指定 model 字段');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      warnings: warnings
    };
  }

  // ==================== 自定义下拉组件 ====================

  const DROPDOWN_MAX_VISIBLE_HEIGHT = 280;
  const DROPDOWN_SEARCH_THRESHOLD = 8;

  /**
   * 创建自定义下拉组件
   * @param {{items: Array, placeholder?: string, value?: string, onChange?: Function, maxHeight?: number, searchThreshold?: number}} options
   * @returns {HTMLElement}
   */
  function createCustomDropdown(options) {
    const container = document.createElement('div');
    container.className = 'custom-dropdown';
    container.setAttribute('role', 'listbox');
    container.setAttribute('tabindex', '0');

    const trigger = document.createElement('div');
    trigger.className = 'custom-dropdown-trigger';
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-haspopup', 'listbox');

    const triggerText = document.createElement('span');
    triggerText.className = 'dropdown-trigger-text';
    triggerText.textContent = options.placeholder || '请选择…';

    const arrow = document.createElement('span');
    arrow.className = 'dropdown-arrow';
    arrow.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

    trigger.appendChild(triggerText);
    trigger.appendChild(arrow);

    const menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';
    menu.style.maxHeight = options.maxHeight || DROPDOWN_MAX_VISIBLE_HEIGHT + 'px';

    let searchBox = null;
    let optionElements = [];
    let currentValue = options.value || '';
    let highlightedIndex = -1;

    function renderOptions(filter) {
      optionElements = [];
      clearElement(menu);

      const items = options.items || [];
      let filtered = items;
      if (filter && filter.trim()) {
        const lowerFilter = filter.toLowerCase();
        filtered = items.filter(function (item) {
          return String(item.label || item.value || '').toLowerCase().indexOf(lowerFilter) >= 0;
        });
      }

      if (filtered.length > (options.searchThreshold || DROPDOWN_SEARCH_THRESHOLD) && !searchBox) {
        searchBox = document.createElement('div');
        searchBox.className = 'custom-dropdown-search';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = '搜索…';
        searchInput.autocomplete = 'off';
        searchInput.spellcheck = false;
        searchInput.addEventListener('input', function () {
          renderOptions(searchInput.value);
        });
        searchInput.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowDown') { e.preventDefault(); moveHighlight(1); }
          if (e.key === 'ArrowUp') { e.preventDefault(); moveHighlight(-1); }
          if (e.key === 'Enter') { e.preventDefault(); selectHighlighted(); }
          if (e.key === 'Escape') { closeMenu(); }
        });
        searchBox.appendChild(searchInput);
      }

      if (searchBox) {
        menu.appendChild(searchBox);
        const searchInput = searchBox.querySelector('input');
        if (searchInput && filter) searchInput.value = filter;
      }

      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'custom-dropdown-empty';
        empty.textContent = '无匹配项';
        menu.appendChild(empty);
        return;
      }

      filtered.forEach(function (item, idx) {
        const optEl = document.createElement('div');
        optEl.className = 'custom-dropdown-option';
        optEl.setAttribute('role', 'option');
        optEl.textContent = item.label || item.value;
        optEl.dataset.value = item.value;

        if (item.value === currentValue) {
          optEl.classList.add('selected');
        }
        if (item.placeholder) {
          optEl.classList.add('placeholder');
        }

        optEl.addEventListener('mouseenter', function () {
          highlightedIndex = idx;
          updateHighlight();
        });
        optEl.addEventListener('click', function () {
          selectValue(item.value, item.label || item.value);
        });

        optionElements.push(optEl);
        menu.appendChild(optEl);
      });

      highlightedIndex = -1;
    }

    function moveHighlight(dir) {
      if (optionElements.length === 0) return;
      highlightedIndex += dir;
      if (highlightedIndex < 0) highlightedIndex = 0;
      if (highlightedIndex >= optionElements.length) highlightedIndex = optionElements.length - 1;
      updateHighlight();
    }

    function updateHighlight() {
      optionElements.forEach(function (el, idx) {
        if (idx === highlightedIndex) {
          el.classList.add('highlighted');
          el.scrollIntoView({ block: 'nearest' });
        } else {
          el.classList.remove('highlighted');
        }
      });
    }

    function selectHighlighted() {
      if (highlightedIndex >= 0 && highlightedIndex < optionElements.length) {
        const el = optionElements[highlightedIndex];
        selectValue(el.dataset.value, el.textContent);
      }
    }

    function selectValue(value, label) {
      currentValue = value;
      triggerText.textContent = label || value || options.placeholder || '请选择…';
      closeMenu();
      if (options.onChange) options.onChange(value);
    }

    function openMenu() {
      container.classList.add('open');
      renderOptions('');
      if (searchBox) {
        const searchInput = searchBox.querySelector('input');
        if (searchInput) setTimeout(function () { searchInput.focus(); }, 50);
      }
    }

    function closeMenu() {
      container.classList.remove('open');
      highlightedIndex = -1;
    }

    function toggleMenu() {
      if (container.classList.contains('open')) {
        closeMenu();
      } else {
        openMenu();
      }
    }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMenu();
    });

    container.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMenu(); }
      if (e.key === 'Escape') { closeMenu(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!container.classList.contains('open')) openMenu(); else moveHighlight(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveHighlight(-1); }
    });

    document.addEventListener('click', function (e) {
      if (!container.contains(e.target)) closeMenu();
    });

    container.appendChild(trigger);
    container.appendChild(menu);

    container.setValue = function (value) {
      currentValue = value;
      const items = options.items || [];
      const found = items.find(function (item) { return item.value === value; });
      triggerText.textContent = found ? (found.label || found.value) : (value || options.placeholder || '请选择…');
    };

    container.getValue = function () {
      return currentValue;
    };

    container.updateItems = function (newItems) {
      options.items = newItems;
      if (container.classList.contains('open')) {
        renderOptions('');
      }
    };

    return container;
  }

  /**
   * 标准化端点路径（去除前导斜杠）
   * @param {string} path
   * @returns {string}
   */
  function normalizeEndpointPath(path) {
    if (!path || typeof path !== 'string') return path;
    return path.replace(/^\/+/, '');
  }

  /**
   * 构建完整的 API URL
   * @param {string} base
   * @param {string} path
   * @returns {string}
   */
  function buildNormalizedEndpointPath(base, path) {
    const cleanBase = (base || '').replace(/\/+$/, '');
    const cleanPath = normalizeEndpointPath(path);
    if (!cleanPath) return cleanBase;
    return cleanBase + '/' + cleanPath;
  }

  /**
   * 清空元素的子节点
   * @param {HTMLElement} el
   */
  function clearElement(el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  // ==================== 公共工具函数 ====================

  /**
   * 创建 spinner 加载动画元素
   * @returns {HTMLElement}
   */
  function createSpinner() {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    return spinner;
  }

  /**
   * 从表单元素构建配置数据对象
   * @param {string} baseUrl
   * @param {string} endpointPath
   * @param {string} httpMethod
   * @param {Array} headers
   * @param {object} body
   * @param {Array} customParams
   * @returns {{baseUrl: string, endpointPath: string, httpMethod: string, headers: Array, body: object, customParams: Array}}
   */
  function buildConfigData(baseUrl, endpointPath, httpMethod, headers, body, customParams) {
    return {
      baseUrl: baseUrl,
      endpointPath: endpointPath,
      httpMethod: httpMethod,
      headers: headers.map(function (h) { return { key: h.key, value: h.value }; }),
      body: deepClone(body),
      customParams: deepClone(customParams)
    };
  }

  /**
   * 可重试的 fetch 封装
   * @param {string} url
   * @param {object} fetchOptions
   * @param {{maxRetries?: number, retryDelay?: Function, onRetry?: Function, retryableStatuses?: Array<number>}} retryOptions
   * @returns {Promise<Response>}
   */
  async function retryableFetch(url, fetchOptions, retryOptions) {
    const maxRetries = retryOptions.maxRetries || 0;
    const retryableStatuses = retryOptions.retryableStatuses || [429, 502, 503, 504];
    const retryDelayFn = retryOptions.retryDelay || defaultRetryDelay;
    const onRetry = retryOptions.onRetry || (function () {});

    /**
     * 默认重试延迟：指数退避 + 随机抖动
     * @param {number} retryCount
     * @param {Response} [response]
     * @returns {number} 毫秒
     */
    function defaultRetryDelay(retryCount, response) {
      if (response && response.headers) {
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const retrySeconds = parseInt(retryAfter, 10);
          if (!isNaN(retrySeconds)) return retrySeconds * 1000;
          const retryDate = new Date(retryAfter);
          return Math.max(0, retryDate.getTime() - Date.now());
        }
      }
      return Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const signal = fetchOptions.signal;
      if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');

      try {
        const response = await fetch(url, fetchOptions);

        if (retryableStatuses.includes(response.status) && attempt < maxRetries) {
          const delay = retryDelayFn(attempt, response);
          onRetry(response.status, attempt, delay);
          await new Promise(function (r) { setTimeout(r, delay); });
          continue;
        }

        return response;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (attempt < maxRetries) {
          const delay = retryDelayFn(attempt, null);
          onRetry('NETWORK_ERROR', attempt, delay);
          await new Promise(function (r) { setTimeout(r, delay); });
          continue;
        }
        throw err;
      }
    }

    throw new Error('Max retries exceeded');
  }

  /**
   * 解析 SSE 流响应，提取文本内容和事件
   * @param {ReadableStream} body
   * @param {{onDelta?: Function, onEvent?: Function}} callbacks
   * @returns {Promise<{fullContent: string, events: Array<object>}>}
   */
  async function parseSseStream(body, callbacks) {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullContent = '';
    const fullEvents = [];
    const onDelta = callbacks && callbacks.onDelta || (function () {});
    const onEvent = callbacks && callbacks.onEvent || (function () {});
    let inReasoning = false;

    while (true) {
      const result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentData = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line === '') {
          if (currentData) {
            const data = currentData;
            currentData = '';
            if (data === '[DONE]') {
              if (inReasoning) {
                fullContent += '\n\n';
                inReasoning = false;
              }
              continue;
            }
            try {
              const event = JSON.parse(data);
              fullEvents.push(event);
              onEvent(event);

              let deltaText = '';
              if (event.choices && event.choices[0] && event.choices[0].delta) {
                const reasoning = event.choices[0].delta.reasoning_content;
                const content = event.choices[0].delta.content || '';
                if (reasoning) {
                  if (!inReasoning) {
                    deltaText = '[思考] ' + reasoning;
                    inReasoning = true;
                  } else {
                    deltaText = reasoning;
                  }
                } else if (content) {
                  if (inReasoning) {
                    deltaText = '\n\n' + content;
                    inReasoning = false;
                  } else {
                    deltaText = content;
                  }
                }
              } else if (event.output && event.output[0] && event.output[0].content && event.output[0].content[0] && event.output[0].content[0].text) {
                deltaText = event.output[0].content[0].text;
              }
              fullContent += deltaText;
              if (deltaText) onDelta(deltaText, fullContent);
            } catch (e) {
              // 忽略非 JSON 行
            }
          }
          continue;
        }

        if (line.startsWith('data:')) {
          currentData += line.substring(5).trim();
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
            onEvent(event);

            let deltaText = '';
            if (event.choices && event.choices[0] && event.choices[0].delta) {
              const reasoning = event.choices[0].delta.reasoning_content;
              const content = event.choices[0].delta.content || '';
              if (reasoning) {
                if (!inReasoning) {
                  deltaText = '[思考] ' + reasoning;
                  inReasoning = true;
                } else {
                  deltaText = reasoning;
                }
              } else if (content) {
                if (inReasoning) {
                  deltaText = '\n\n' + content;
                  inReasoning = false;
                } else {
                  deltaText = content;
                }
              }
            } else if (event.output && event.output[0] && event.output[0].content && event.output[0].content[0] && event.output[0].content[0].text) {
              deltaText = event.output[0].content[0].text;
            }
            fullContent += deltaText;
            if (deltaText) onDelta(deltaText, fullContent);
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    if (inReasoning) {
      fullContent += '\n\n';
    }

    return { fullContent: fullContent, events: fullEvents };
  }

  // ==================== 暴露给全局 ====================

  // 兼容旧版 encryptValue/decryptValue 别名
  const encryptValue = obfuscateValue;
  const decryptValue = deobfuscateValue;

  window.AppConfig = {
    ENDPOINT_TEMPLATES: ENDPOINT_TEMPLATES,
    CUSTOM_PARAM_PRESETS: CUSTOM_PARAM_PRESETS,
    SENSITIVE_HEADER_KEYS: SENSITIVE_HEADER_KEYS,
    PLACEHOLDER_API_KEY: PLACEHOLDER_API_KEY,
    MAX_HISTORY_ITEMS: MAX_HISTORY_ITEMS,
    FETCH_MODELS_TIMEOUT_MS: FETCH_MODELS_TIMEOUT_MS,
    TOAST_DISPLAY_MS: TOAST_DISPLAY_MS,
    JSON_SYNC_DELAY_MS: JSON_SYNC_DELAY_MS,
    JSON_PREVIEW_DELAY_MS: JSON_PREVIEW_DELAY_MS,
    FETCH_MODELS_DEBOUNCE_MS: FETCH_MODELS_DEBOUNCE_MS,
    MAX_UPLOAD_FILE_SIZE_MB: MAX_UPLOAD_FILE_SIZE_MB,
    MAX_UPLOAD_TOTAL_SIZE_MB: MAX_UPLOAD_TOTAL_SIZE_MB,
    CACHE_TTL_MS: CACHE_TTL_MS,
    CACHE_MAX_ENTRIES: CACHE_MAX_ENTRIES,
    CHAT_REQUEST_TIMEOUT_MS: CHAT_REQUEST_TIMEOUT_MS,
    CHAT_MAX_RETRIES: CHAT_MAX_RETRIES,
    REQUEST_DEDUP_WINDOW_MS: REQUEST_DEDUP_WINDOW_MS,
    getEndpointParams: getEndpointParams,
    getEndpointDefaultBody: getEndpointDefaultBody,
    endpointHasMessages: endpointHasMessages,
    isSensitiveHeader: isSensitiveHeader,
    isPlaceholderApiKey: isPlaceholderApiKey,
    maskSensitiveValue: maskSensitiveValue,
    validateParamValue: validateParamValue,
    createDefaultConfig: createDefaultConfig,
    isLocalStorageAvailable: isLocalStorageAvailable,
    safeGetLocalStorage: safeGetLocalStorage,
    safeSetLocalStorage: safeSetLocalStorage,
    loadHistory: loadHistory,
    saveHistory: saveHistory,
    loadSavedConfigs: loadSavedConfigs,
    saveSavedConfigs: saveSavedConfigs,
    saveConfig: saveConfig,
    deleteConfig: deleteConfig,
    getConfigByName: getConfigByName,
    deepClone: deepClone,
    buildEndpointSelectOptions: buildEndpointSelectOptions,
    extractPresetParamsFromBody: extractPresetParamsFromBody,
    // 新名称（推荐使用）
    obfuscateValue: obfuscateValue,
    deobfuscateValue: deobfuscateValue,
    // 旧名称（向后兼容，标记为已弃用）
    encryptValue: encryptValue,
    decryptValue: decryptValue,
    saveApiKey: saveApiKey,
    getApiKey: getApiKey,
    getActiveApiKey: getActiveApiKey,
    setActiveApiKey: setActiveApiKey,
    deleteApiKey: deleteApiKey,
    listApiKeys: listApiKeys,
    maskApiKey: maskApiKey,
    validateApiKey: validateApiKey,
    resolveApiKeyFromSources: resolveApiKeyFromSources,
    escapeJsonString: escapeJsonString,
    sanitizeConfigValue: sanitizeConfigValue,
    validateConfig: validateConfig,
    getCacheKey: getCacheKey,
    getCachedResponse: getCachedResponse,
    setCachedResponse: setCachedResponse,
    invalidateCache: invalidateCache,
    getPendingRequest: getPendingRequest,
    setPendingRequest: setPendingRequest,
    removePendingRequest: removePendingRequest,
    stripEmptyValues: stripEmptyValues,
    buildCompactBody: buildCompactBody,
    createCustomDropdown: createCustomDropdown,
    normalizeEndpointPath: normalizeEndpointPath,
    buildNormalizedEndpointPath: buildNormalizedEndpointPath,
    clearElement: clearElement,
    createSpinner: createSpinner,
    buildConfigData: buildConfigData,
    retryableFetch: retryableFetch,
    parseSseStream: parseSseStream,
    DROPDOWN_MAX_VISIBLE_HEIGHT: DROPDOWN_MAX_VISIBLE_HEIGHT,
    DROPDOWN_SEARCH_THRESHOLD: DROPDOWN_SEARCH_THRESHOLD,
    loadApiKeyStore: loadApiKeyStore,
    API_KEY_STORE_KEY: API_KEY_STORE_KEY
  };
})();