# OpenAI API Debugger

一个简洁的浏览器端 OpenAI API 调试工具，兼容 Chat Completions 与 Responses 接口。

## 功能

- **双模式编辑**：表单模式（可视化配置 messages、常用参数）与 JSON 模式（自由编辑请求体）
- **SSE 流式响应**：实时显示流式输出内容
- **多格式响应预览**：自动识别 JSON、图片、音频、视频等响应类型
- **历史记录**：自动保存最近 20 条请求记录，支持一键还原与导出
- **配置持久化**：配置与历史记录保存在浏览器 localStorage
- **URL 参数分享**：通过 URL 参数分享当前配置

## 文件结构

```
web/
├── index.html   # 页面结构
├── style.css    # 样式（暗色主题）
├── config.js    # 默认配置与工具函数
└── app.js       # 主逻辑（请求发送、响应渲染、历史管理等）
```

## 使用方式

1. 直接用浏览器打开 `web/index.html`
2. 填写 Base URL、端点路径与 API Key
3. 在表单或 JSON 模式中配置请求参数
4. 点击「发送请求」查看响应

## 技术说明

- 纯前端实现，无需后端服务
- 使用原生 Fetch API 发送请求
- 依赖浏览器 localStorage 存储数据
