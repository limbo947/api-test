# OpenAI API 调试器 — 设计规范文档 v3.0

## 概述

本文档定义了 OpenAI API 调试器的完整视觉设计系统 v3.0。本次重构聚焦于：提升信息层级清晰度、优化阅读体验、建立更严谨的空间系统、强化视觉一致性。

---

## 设计原则

1. **功能优先**：作为开发者工具，信息密度和操作效率高于装饰性
2. **深色为基**：所有方案均为深色主题，减少长时间使用的视觉疲劳
3. **层次分明**：通过色彩、阴影、边框建立清晰的视觉层级
4. **微交互克制**：动效服务于功能反馈，不干扰工作流
5. **响应式适配**：桌面端（≥1024px）、平板端（768-1024px）、移动端（<768px）
6. **一致性优先**：所有组件遵循统一的设计语言，避免视觉碎片

---

## 色彩系统

### 色彩哲学

采用 **"深空基底 + 单主色强调"** 的设计策略：
- 背景层使用极深的冷色调，确保长时间使用不疲劳
- 主色用于所有交互元素和关键信息，保持单一焦点
- 辅助色仅用于语义状态（成功/警告/错误），不分散注意力
- 中性色建立完整的文字层级

### 方案 A：极光科技 (Aurora)

| Token | 值 | 用途 |
|-------|-----|------|
| `--bg` | `#050811` | 最深背景 |
| `--bg-elevated` | `#0a1020` |  elevated 背景 |
| `--surface` | `rgba(12, 20, 40, 0.65)` | 卡片表面 |
| `--surface-solid` | `#0d1528` | 实色表面 |
| `--surface-hover` | `rgba(18, 30, 56, 0.75)` | 悬停表面 |
| `--text-primary` | `#f0f5ff` | 主要文字 |
| `--text-secondary` | `#8aa4cc` | 次要文字 |
| `--text-tertiary` | `#4a6080` | 辅助/禁用文字 |
| `--accent` | `#3db4f7` | 主强调色（天蓝） |
| `--accent-hover` | `#5cc8ff` | 悬停强调色 |
| `--accent-muted` | `rgba(61, 180, 247, 0.15)` | 强调色背景 |
| `--accent-glow` | `rgba(61, 180, 247, 0.08)` | 强调色发光 |
| `--danger` | `#ef4444` | 错误/危险 |
| `--success` | `#22c55e` | 成功 |
| `--warning` | `#f59e0b` | 警告 |
| `--border` | `rgba(60, 90, 140, 0.25)` | 默认边框 |
| `--border-hover` | `rgba(61, 180, 247, 0.35)` | 悬停边框 |
| `--border-focus` | `rgba(61, 180, 247, 0.5)` | 聚焦边框 |

### 方案 B：暖光工坊 (Warm)

| Token | 值 | 用途 |
|-------|-----|------|
| `--bg` | `#0f0c08` | 最深背景 |
| `--bg-elevated` | `#1a1410` | elevated 背景 |
| `--surface` | `rgba(26, 20, 14, 0.65)` | 卡片表面 |
| `--surface-solid` | `#1a1410` | 实色表面 |
| `--surface-hover` | `rgba(36, 28, 18, 0.75)` | 悬停表面 |
| `--text-primary` | `#fff5e6` | 主要文字 |
| `--text-secondary` | `#c4a06a` | 次要文字 |
| `--text-tertiary` | `#7a6038` | 辅助/禁用文字 |
| `--accent` | `#f0a030` | 主强调色（琥珀） |
| `--accent-hover` | `#ffc04d` | 悬停强调色 |
| `--accent-muted` | `rgba(240, 160, 48, 0.15)` | 强调色背景 |
| `--accent-glow` | `rgba(240, 160, 48, 0.08)` | 强调色发光 |
| `--danger` | `#ef4444` | 错误/危险 |
| `--success` | `#22c55e` | 成功 |
| `--warning` | `#f59e0b` | 警告 |
| `--border` | `rgba(120, 90, 50, 0.25)` | 默认边框 |
| `--border-hover` | `rgba(240, 160, 48, 0.35)` | 悬停边框 |
| `--border-focus` | `rgba(240, 160, 48, 0.5)` | 聚焦边框 |

### 方案 C：星际指挥 (Cosmic)

| Token | 值 | 用途 |
|-------|-----|------|
| `--bg` | `#08051a` | 最深背景 |
| `--bg-elevated` | `#120a2e` | elevated 背景 |
| `--surface` | `rgba(18, 10, 46, 0.65)` | 卡片表面 |
| `--surface-solid` | `#120a2e` | 实色表面 |
| `--surface-hover` | `rgba(28, 16, 66, 0.75)` | 悬停表面 |
| `--text-primary` | `#f5f0ff` | 主要文字 |
| `--text-secondary` | `#c4a8e8` | 次要文字 |
| `--text-tertiary` | `#7a5a9a` | 辅助/禁用文字 |
| `--accent` | `#e879f9` | 主强调色（霓虹粉） |
| `--accent-hover` | `#f0abfc` | 悬停强调色 |
| `--accent-muted` | `rgba(232, 121, 249, 0.15)` | 强调色背景 |
| `--accent-glow` | `rgba(232, 121, 249, 0.08)` | 强调色发光 |
| `--danger` | `#fb7185` | 错误/危险 |
| `--success` | `#4ade80` | 成功 |
| `--warning` | `#facc15` | 警告 |
| `--border` | `rgba(130, 60, 180, 0.25)` | 默认边框 |
| `--border-hover` | `rgba(232, 121, 249, 0.35)` | 悬停边框 |
| `--border-focus` | `rgba(232, 121, 249, 0.5)` | 聚焦边框 |

---

## 排版系统

### 字体选择

- **界面字体**: `Inter` — 现代、高可读性、优秀的数字显示
- **代码字体**: `JetBrains Mono` — 开发者首选，清晰易辨
- **中文回退**: `"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`

### 字体层级

| 层级 | 大小 | 字重 | 行高 | 字间距 | 用途 |
|------|------|------|------|--------|------|
| Display | 1.5rem (24px) | 700 | 1.2 | -0.02em | 页面主标题 |
| H1 | 1.25rem (20px) | 600 | 1.3 | -0.01em | 区块标题 |
| H2 | 0.875rem (14px) | 600 | 1.4 | 0.02em | 卡片标题、分组标题 |
| H3 | 0.8125rem (13px) | 500 | 1.4 | 0.01em | 子标题、标签 |
| Body | 0.875rem (14px) | 400 | 1.6 | 0 | 正文内容 |
| Small | 0.8125rem (13px) | 400 | 1.5 | 0 | 辅助说明 |
| Caption | 0.75rem (12px) | 400 | 1.5 | 0.01em | 最小文字、时间戳 |
| Code | 0.8125rem (13px) | 400 | 1.7 | 0 | 代码、JSON |

### 排版规则

1. **标题不使用大写**：中文环境下大写标题不自然，改用字重和颜色区分
2. **正文最佳宽度**：最大 75ch，确保阅读舒适度
3. **数字等宽**：所有数字、代码使用等宽字体，确保对齐
4. **行高适配**：中文内容行高 1.6-1.8，英文 1.5-1.6

---

## 空间系统

### 间距基数：4px

| Token | 值 | 用途 |
|-------|-----|------|
| `--space-1` | 4px | 图标与文字间距 |
| `--space-2` | 8px | 紧凑元素间距 |
| `--space-3` | 12px | 表单元素间距 |
| `--space-4` | 16px | 卡片内部小间距 |
| `--space-5` | 20px | 卡片内边距 |
| `--space-6` | 24px | 区块间距 |
| `--space-8` | 32px | 大区块间距 |
| `--space-10` | 40px | 页面边距 |
| `--space-12` | 48px | 超大间距 |

### 圆角系统

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius-sm` | 6px | 按钮、标签、小元素 |
| `--radius-md` | 10px | 输入框、卡片 |
| `--radius-lg` | 14px | 大卡片、面板 |
| `--radius-xl` | 18px | 模态框、大面板 |
| `--radius-full` | 9999px | 圆形元素 |

---

## 组件规范

### 按钮

**主按钮 (Primary)**
- 背景：`--accent`
- 文字：`--bg`（深色背景上的反白文字）
- 圆角：`--radius-sm`
- 内边距：`10px 20px`
- 字重：600
- 悬停：背景 `--accent-hover`，轻微上移 (-1px)
- 聚焦：`0 0 0 2px var(--border-focus)` 外发光

**次要按钮 (Secondary)**
- 背景：`transparent`
- 边框：`1px solid var(--border)`
- 文字：`--text-secondary`
- 悬停：背景 `--accent-muted`，边框 `--border-hover`，文字 `--text-primary`

**危险按钮 (Danger)**
- 背景：`var(--danger)`
- 文字：`#fff`
- 悬停：背景 `#dc2626`，阴影 `0 4px 12px rgba(239, 68, 68, 0.25)`

**图标按钮 (Icon)**
- 尺寸：36px × 36px
- 背景：`transparent`
- 边框：`1px solid var(--border)`
- 悬停：背景 `rgba(255,255,255,0.05)`，边框 `--border-hover`

### 卡片

- 背景：`--surface`
- 边框：`1px solid var(--border)`
- 圆角：`--radius-lg`
- 内边距：`--space-5` (20px)
- 阴影：`0 2px 8px rgba(0,0,0,0.2)`
- 悬停：边框 `--border-hover`，阴影 `0 4px 16px rgba(0,0,0,0.3)`，**不移位**

### 输入框

- 背景：`--surface-solid`
- 边框：`1px solid var(--border)`
- 圆角：`--radius-sm`
- 内边距：`10px 14px`
- 文字：`--text-primary`
- 占位符：`--text-tertiary`
- 悬停：边框 `--border-hover`
- 聚焦：边框 `--accent`，外发光 `0 0 0 3px var(--accent-muted)`

### 标签页 (Tabs)

- 容器背景：`rgba(255,255,255,0.03)`
- 容器圆角：`--radius-md`
- 容器内边距：`4px`
- 标签项：圆角 `--radius-sm`，内边距 `8px 16px`
- 未激活：文字 `--text-tertiary`
- 激活：背景 `--accent-muted`，文字 `--accent`，字重 600
- 切换过渡：`0.2s ease`

### 侧边栏

- 宽度：240px（桌面端）
- 背景：`rgba(5, 8, 17, 0.95)` + `backdrop-filter: blur(20px)`
- 边框：右侧 `1px solid var(--border)`
- 品牌区：内边距 `20px`，底部边框分隔
- 导航项：内边距 `10px 16px`，圆角 `--radius-sm`
- 激活项：背景 `--accent-muted`，文字 `--accent`，左侧 3px 指示条

---

## 布局系统

### 页面结构

```
┌─────────────────────────────────────────────┐
│  Sidebar (240px)  │  Main Content Area       │
│                   │  ┌─────────────────────┐ │
│  - Brand          │  │  Config Panel       │ │
│  - Navigation     │  │  (Request settings) │ │
│  - Theme Switch   │  ├─────────────────────┤ │
│                   │  │  Response Panel     │ │
│                   │  │  (Output display)   │ │
│                   │  └─────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 响应式断点

| 断点 | 宽度 | 布局变化 |
|------|------|----------|
| Desktop | ≥1280px | 完整三栏布局 |
| Laptop | 1024-1279px | 侧边栏收缩至 64px（图标模式） |
| Tablet | 768-1023px | 侧边栏隐藏，汉堡菜单 |
| Mobile | <768px | 单栏堆叠布局 |

---

## 动效规范

### 过渡时间

| 场景 | 时长 | 缓动函数 |
|------|------|----------|
| 颜色/背景变化 | 200ms | `ease` |
| 边框/阴影变化 | 200ms | `ease` |
| 尺寸变化 | 250ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| 位置变化 | 300ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| 面板展开/收起 | 300ms | `cubic-bezier(0.4, 0, 0.2, 1)` |

### 动效原则

1. **不使用位移作为悬停反馈**：卡片悬停只改变边框和阴影，不上移
2. **按钮悬停可轻微上移** (-1px)：给用户明确的点击暗示
3. **面板动画使用 transform**：避免触发重排，使用 `translateX` 而非 `left`
4. **减少运动偏好**：`prefers-reduced-motion: reduce` 时禁用所有动画

---

## 视觉层次策略

### 信息层级

1. **第一层级（最重要）**：页面标题、主操作按钮、关键状态
   - 使用 `--text-primary` + 大字重
   - 使用 `--accent` 背景或文字

2. **第二层级（重要）**：卡片标题、表单标签、导航项
   - 使用 `--text-secondary`
   - 使用 H2/H3 字号

3. **第三层级（辅助）**：说明文字、占位符、次要信息
   - 使用 `--text-tertiary`
   - 使用 Small/Caption 字号

### 分组策略

- **卡片分组**：相关表单元素放入同一卡片
- **边框分组**：卡片标题下方使用 `1px solid var(--border)` 分隔
- **间距分组**：相关元素间距 12px，不同组间距 20px
- **背景分组**：交替使用 `--surface` 和 `--surface-solid` 区分层级

---

## 实现说明

### CSS 自定义属性组织

```css
:root {
  /* 色彩 */
  --bg: #050811;
  --surface: rgba(12, 20, 40, 0.65);
  --text-primary: #f0f5ff;
  --text-secondary: #8aa4cc;
  --text-tertiary: #4a6080;
  --accent: #3db4f7;
  --accent-hover: #5cc8ff;
  --accent-muted: rgba(61, 180, 247, 0.15);
  --border: rgba(60, 90, 140, 0.25);

  /* 间距 */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;

  /* 圆角 */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  /* 字体 */
  --font-sans: 'Inter', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', Consolas, Monaco, 'Courier New', monospace;
}
```

### 性能优化

1. **backdrop-filter 谨慎使用**：仅在侧边栏和浮动面板使用，避免大面积应用
2. **阴影优化**：使用 `box-shadow` 而非 `drop-shadow`，性能更好
3. **will-change**：仅在动画元素上添加，动画结束后移除
4. **字体加载**：使用 `font-display: swap` 避免 FOIT
