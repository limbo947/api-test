// config.js – 默认配置与工具函数
;(function () {
  'use strict';

  const SENSITIVE_HEADER_KEYS = new Set([
    'authorization', 'api-key', 'x-api-key',
    'cookie', 'set-cookie', 'proxy-authorization'
  ]);

  const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
  const DEFAULT_ENDPOINT = '/chat/completions';

  const DEFAULT_HEADERS = [
    { key: 'Authorization', value: 'Bearer YOUR_API_KEY' },
    { key: 'Content-Type', value: 'application/json' }
  ];

  const ENDPOINT_TEMPLATES = {
    '/chat/completions': {
      params: [
        { name: 'model', type: 'text', placeholder: '模型 ID，如 gpt-4o、o3-mini', description: '使用的模型 ID', datalist: 'modelDatalist' },
        { name: 'stream', type: 'checkbox', default: false, description: '是否启用流式响应（Server-Sent Events）' }
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
    '/responses': {
      params: [
        { name: 'model', type: 'text', placeholder: '模型 ID，如 gpt-4o、o3-mini', description: '使用的模型 ID', datalist: 'modelDatalist' },
        { name: 'stream', type: 'checkbox', default: false, description: '是否启用流式响应（Server-Sent Events）' }
      ],
      body: {
        model: '',
        input: '',
        stream: false
      },
      hasMessages: false
    },
    '/embeddings': {
      params: [
        { name: 'model', type: 'text', placeholder: '嵌入模型 ID', description: '使用的嵌入模型 ID，如 text-embedding-3-small', datalist: 'modelDatalist' }
      ],
      body: {
        model: 'text-embedding-3-small',
        input: ''
      },
      hasMessages: false
    },
    '/images/generations': {
      params: [
        { name: 'model', type: 'text', placeholder: '图像模型 ID', description: '使用的图像生成模型，如 dall-e-3', datalist: 'modelDatalist' }
      ],
      body: {
        model: 'dall-e-3',
        prompt: ''
      },
      hasMessages: false
    },
    '/audio/transcriptions': {
      params: [
        { name: 'model', type: 'text', placeholder: '音频模型 ID', description: '使用的音频转录模型，如 whisper-1', datalist: 'modelDatalist' }
      ],
      body: {
        model: 'whisper-1'
      },
      hasMessages: false
    },
    '/audio/translations': {
      params: [
        { name: 'model', type: 'text', placeholder: '音频模型 ID', description: '使用的音频翻译模型，如 whisper-1', datalist: 'modelDatalist' }
      ],
      body: {
        model: 'whisper-1'
      },
      hasMessages: false
    },
    '/audio/speech': {
      params: [
        { name: 'model', type: 'text', placeholder: '语音模型 ID', description: '使用的语音合成模型，如 tts-1', datalist: 'modelDatalist' }
      ],
      body: {
        model: 'tts-1',
        input: ''
      },
      hasMessages: false
    },
    '/models': {
      params: [],
      body: {},
      hasMessages: false
    }
  };

  function getEndpointParams(endpointPath) {
    const template = ENDPOINT_TEMPLATES[endpointPath];
    return template ? template.params : ENDPOINT_TEMPLATES['/chat/completions'].params;
  }

  function getEndpointDefaultBody(endpointPath) {
    const template = ENDPOINT_TEMPLATES[endpointPath];
    return template ? deepClone(template.body) : deepClone(ENDPOINT_TEMPLATES['/chat/completions'].body);
  }

  function endpointHasMessages(endpointPath) {
    const template = ENDPOINT_TEMPLATES[endpointPath];
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

  function isSensitiveHeader(key) {
    return SENSITIVE_HEADER_KEYS.has(key.toLowerCase());
  }

  function createDefaultConfig() {
    return {
      baseUrl: DEFAULT_BASE_URL,
      endpointPath: DEFAULT_ENDPOINT,
      httpMethod: 'POST',
      headers: DEFAULT_HEADERS.map(h => ({ ...h })),
      body: {
        model: '',
        messages: [
          { role: 'system', content: '你是一个有帮助的助手。' },
          { role: 'user', content: '' }
        ],
        temperature: 1.0,
        max_tokens: 4096,
        top_p: 1.0,
        presence_penalty: 0.0,
        frequency_penalty: 0.0,
        stream: false
      },
      customParams: [],
      jsonMode: false
    };
  }

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

  function loadHistory() {
    return safeGetLocalStorage(HISTORY_STORAGE_KEY) || [];
  }

  function saveHistory(history) {
    if (!safeSetLocalStorage(HISTORY_STORAGE_KEY, history)) {
      if (typeof showToast === 'function') {
        showToast('保存历史记录失败：浏览器存储不可用', 'error');
      }
    }
  }

  function loadSavedConfigs() {
    return safeGetLocalStorage(CONFIG_STORAGE_KEY) || [];
  }

  function saveSavedConfigs(configs) {
    if (!safeSetLocalStorage(CONFIG_STORAGE_KEY, configs)) {
      if (typeof showToast === 'function') {
        showToast('保存配置失败：浏览器存储不可用', 'error');
      }
    }
  }

  function saveConfig(name, configData) {
    const configs = loadSavedConfigs();
    const existingIndex = configs.findIndex(c => c.name === name);
    const configToSave = {
      name,
      ...deepClone(configData),
      savedAt: new Date().toISOString()
    };
    if (existingIndex >= 0) {
      configs[existingIndex] = configToSave;
    } else {
      configs.push(configToSave);
    }
    saveSavedConfigs(configs);
    return existingIndex >= 0 ? '覆盖' : '新建';
  }

  function deleteConfig(name) {
    const configs = loadSavedConfigs();
    const filtered = configs.filter(c => c.name !== name);
    saveSavedConfigs(filtered);
  }

  function getConfigByName(name) {
    const configs = loadSavedConfigs();
    return configs.find(c => c.name === name);
  }

  function deepClone(obj) {
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(obj);
      } catch (e) {
        // structuredClone 失败时回退（如包含函数或 DOM 节点）
      }
    }
    return JSON.parse(JSON.stringify(obj));
  }

  function buildEndpointSelectOptions() {
    const endpointLabels = {
      '/chat/completions': '/chat/completions (聊天补全)',
      '/responses': '/responses (统一响应)',
      '/embeddings': '/embeddings (文本嵌入)',
      '/images/generations': '/images/generations (图像生成)',
      '/audio/transcriptions': '/audio/transcriptions (音频转录)',
      '/audio/translations': '/audio/translations (音频翻译)',
      '/audio/speech': '/audio/speech (文本转语音)',
      '/models': '/models (列出模型)'
    };

    let html = '<option value="" selected>-- 选择预设端点 --</option>';
    Object.keys(ENDPOINT_TEMPLATES).forEach(path => {
      const label = endpointLabels[path] || path;
      html += '<option value="' + path + '">' + label + '</option>';
    });
    html += '<option value="custom">自定义路径...</option>';
    return html;
  }

  // 导出仅需的内容到全局作用域
  window.ENDPOINT_TEMPLATES = ENDPOINT_TEMPLATES;
  window.CUSTOM_PARAM_PRESETS = CUSTOM_PARAM_PRESETS;
  window.SENSITIVE_HEADER_KEYS = SENSITIVE_HEADER_KEYS;
  window.getEndpointParams = getEndpointParams;
  window.getEndpointDefaultBody = getEndpointDefaultBody;
  window.endpointHasMessages = endpointHasMessages;
  window.isSensitiveHeader = isSensitiveHeader;
  window.validateParamValue = validateParamValue;
  window.createDefaultConfig = createDefaultConfig;
  window.isLocalStorageAvailable = isLocalStorageAvailable;
  window.safeGetLocalStorage = safeGetLocalStorage;
  window.safeSetLocalStorage = safeSetLocalStorage;
  window.loadHistory = loadHistory;
  window.saveHistory = saveHistory;
  window.loadSavedConfigs = loadSavedConfigs;
  window.saveSavedConfigs = saveSavedConfigs;
  window.saveConfig = saveConfig;
  window.deleteConfig = deleteConfig;
  window.getConfigByName = getConfigByName;
  window.deepClone = deepClone;
  window.buildEndpointSelectOptions = buildEndpointSelectOptions;
})();