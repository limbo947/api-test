// config.js – 存放默认配置与工具函数

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_ENDPOINT = '/chat/completions';

const DEFAULT_HEADERS = [
  { key: 'Authorization', value: 'Bearer YOUR_API_KEY' },
  { key: 'Content-Type', value: 'application/json' }
];

// Chat Completions 常用参数
const CHAT_PARAMS = [
  { name: 'model', type: 'text', placeholder: 'gpt-4o / gpt-5.5' },
  { name: 'temperature', type: 'number', min: 0, max: 2, step: 0.1, default: 1.0 },
  { name: 'max_tokens', type: 'number', min: 1, step: 1, placeholder: '最大生成 token 数' },
  { name: 'top_p', type: 'number', min: 0, max: 1, step: 0.1, default: 1.0 },
  { name: 'presence_penalty', type: 'number', min: -2, max: 2, step: 0.1, default: 0.0 },
  { name: 'frequency_penalty', type: 'number', min: -2, max: 2, step: 0.1, default: 0.0 },
  { name: 'stream', type: 'checkbox', default: false },
  { name: 'stop', type: 'text', placeholder: '停止序列，多个用逗号分隔' },
  { name: 'n', type: 'number', min: 1, step: 1, default: 1 },
  { name: 'logit_bias', type: 'text', placeholder: 'JSON，如 {"1234": -100}' },
  { name: 'user', type: 'text', placeholder: '终端用户标识符' }
];

// Responses API 特有参数（简化，仅做提示）
const RESPONSES_TIPS = [
  '注意：Responses API 使用 input 字段代替 messages',
  'input 可以是字符串或消息数组',
  '如需使用工具，请在 JSON 模式中配置 tools 字段'
];

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
      max_tokens: 1024,
      top_p: 1.0,
      presence_penalty: 0.0,
      frequency_penalty: 0.0,
      stream: false
    },
    customParams: [],
    jsonMode: false
  };
}

// 从 localStorage 加载配置列表
function loadConfigList() {
  try {
    const raw = localStorage.getItem('openai_debugger_configs');
    return JSON.parse(raw) || [];
  } catch (e) {
    return [];
  }
}

function saveConfigList(list) {
  try {
    localStorage.setItem('openai_debugger_configs', JSON.stringify(list));
  } catch (e) {
    console.warn('保存配置列表失败', e);
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem('openai_debugger_history');
    return JSON.parse(raw) || [];
  } catch (e) {
    return [];
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem('openai_debugger_history', JSON.stringify(history));
  } catch (e) {
    console.warn('保存历史失败', e);
  }
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
