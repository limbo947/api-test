# OpenAI API Debugger

一个简洁、安全、高性能的浏览器端 OpenAI API 调试工具，兼容 Chat Completions 与 Responses 接口。

## 功能特性

- **双模式编辑**：表单模式（可视化配置 messages、常用参数）与 JSON 模式（自由编辑请求体）
- **文件上传（多模态）**：支持上传图片、语音、视频文件，自动转为 base64 嵌入 messages
- **SSE 流式响应**：实时显示流式输出内容，增量渲染避免 DOM 频繁重建
- **多格式响应预览**：自动识别 JSON、图片、音频、视频等响应类型
- **历史记录**：自动保存最近 20 条请求记录，支持一键还原与导出（敏感信息自动脱敏）
- **配置持久化**：配置与历史记录保存在浏览器 localStorage，敏感请求头采用混淆存储
- **URL 参数分享**：通过 URL 参数分享当前配置（敏感请求头自动过滤）
- **模型列表获取**：自动从 /models 端点获取模型列表
- **智能重试机制**：遇到 429/502/503/504 错误时自动重试，支持指数退避

## 文件结构

```
web/
├── index.html   # 页面结构（含 CSP 策略）
├── style.css    # 样式（暗色主题、响应式布局）
├── config.js    # 默认配置、端点模板、工具函数
└── app.js       # 主逻辑（模块化架构、安全 DOM 操作）
```

## 使用方式

1. 直接用浏览器打开 `web/index.html`
2. 填写 Base URL、端点路径与 API Key
3. 在表单或 JSON 模式中配置请求参数
4. （可选）上传图片、语音或视频文件，点击「插入到 messages」将文件嵌入请求体
5. 点击「发送请求」查看响应

## 优化亮点

### 代码结构优化
- 采用模块化函数拆分，单一职责原则
- 提取公共工具函数（createElement、debounce、clearElement 等）
- 事件绑定按功能模块分组（bindEndpointEvents、bindHeaderEvents 等）

### 性能优化
- SSE 流式渲染采用增量更新，避免频繁 DOM 重建
- 输入同步使用防抖（debounce）减少计算开销
- 响应式标签切换复用已有数据，避免重复解析

### 安全性增强
- 移除所有不可控 innerHTML，改用安全的 DOM API
- 敏感请求头（Authorization 等）存储时自动混淆
- URL 分享时自动过滤敏感请求头
- 配置导出时敏感信息自动脱敏
- 添加 CSP（Content Security Policy）策略

### 用户体验改进
- 添加 Toast 通知系统替代 alert
- 确认对话框防止误操作（清空历史、删除配置）
- 加载状态指示器（spinner）
- 键盘可访问性支持（Escape 关闭对话框、Enter 选择历史）
- 减少动画偏好支持（prefers-reduced-motion）

### 兼容性优化
- 纯原生 JavaScript，无框架依赖
- 使用 IIFE 避免全局命名空间污染
- 功能降级处理（localStorage 不可用时的优雅降级）
- 响应式布局适配桌面、平板、手机

## 技术说明

- 纯前端实现，无需后端服务
- 使用原生 Fetch API 发送请求
- 依赖浏览器 localStorage 存储数据
- 支持现代浏览器的 Web Crypto API（用于生成幂等键）
