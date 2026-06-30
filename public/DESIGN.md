# DESIGN.md — 仕净CRM品牌设计规范

> 让 AI 生成的每个页面，都符合仕净品牌调性。

---

## M1 — Visual Theme & Atmosphere

仕净CRM的视觉气质：
- **核心关键词**：专业 / 医美 / 高端 / 可信赖 / 温暖
- **情绪版**：专业医美机构的信任感，但不像传统医院那么冷；像一位值得信赖的专业顾问
- **设计哲学**：功能清晰，视觉舒适；用户不需要在UI里感到压力
- **密度**：中等偏低，内容之间留有充分呼吸空间
- **明暗**：整体偏亮，避免大面积深色带来的压抑感

---

## M2 — Color Palette & Roles

基于品牌logo提取的颜色系统：

| 角色 | 色值 | RGB | 使用场景 |
|------|------|-----|---------|
| **Primary** | #1A3A8A | rgb(26, 58, 138) | 主按钮、导航激活态、关键数据、品牌主色 |
| **Primary Light** | #2E5DD6 | rgb(46, 93, 214) | Hover态、次级强调、渐变辅助 |
| **Primary Dark** | #0F2456 | rgb(15, 36, 86) | 按下态、深色背景、导航栏背景 |
| **Accent** | #E67700 | rgb(230, 119, 0) | CTA按钮、重要提示、业绩数据、亮点高亮 |
| **Accent Light** | #FFA066 | rgb(255, 160, 102) | 渐变辅助、hover |
| **Background** | #F5F9FB | rgb(245, 249, 251) | 全局背景（医疗蓝调白）|
| **Surface** | #FFFFFF | rgb(255, 255, 255) | 卡片、输入框、浮层 |
| **Text Primary** | #1D2841 | rgb(29, 40, 65) | 正文 |
| **Text Secondary** | #5A6478 | rgb(90, 100, 120) | 说明文字 |
| **Text Tertiary** | #999999 | rgb(153, 153, 153) | 占位符、次要标签 |
| **Border** | #E8ECF3 | rgb(232, 236, 243) | 边框、分割线 |
| **Silver Light** | #C8D0DB | rgb(200, 208, 219) | 边框亮色、次级分割 |

### 颜色使用原则
- **Primary蓝**：品牌主色，贯穿所有页面，用于导航、按钮、关键信息
- **Accent橙**：业绩、成交、到店等正向数据高亮，营造积极氛围
- **Background白调**：整体偏亮，避免压抑感，体现医美专业与温暖
- **渐变使用**：登录页背景渐变（#0F2456 → #1A3A8A → #2E5DD6），营造专业感

---

## M3 — Typography Rules

### 字体族
- 中文：'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif
- 数字/英文：'SF Pro Display', -apple-system, BlinkMacSystemFont
- 等宽：'SF Mono', 'Fira Code', monospace（用于数据展示）

### 字号层级
| 层级 | 字号 | 字重 | 行高 | 用途 |
|------|------|------|------|------|
| Hero | 28px | 700 | 1.3 | 页面大标题 |
| H1 | 22px | 700 | 1.4 | 模块标题 |
| H2 | 18px | 600 | 1.4 | 卡片标题 |
| Body | 16px | 400 | 1.6 | 正文 |
| Caption | 14px | 400 | 1.5 | 说明文字 |
| XS | 12px | 400 | 1.4 | 标签、角标 |

### 字间距
- 标题用 -0.5px 负间距，营造紧凑感
- 正文保持标准
- 品牌名用 letter-spacing: 1-2px，体现高端感

---

## M4 — Component Stylings

### 登录页品牌区块
```css
.brand-block {
  text-align: center;
  margin-bottom: 28px;
}
.brand-logo {
  width: 72px;
  height: 72px;
  object-fit: contain;
  margin-bottom: 12px;
  filter: drop-shadow(0 4px 12px rgba(26,58,138,.3));
}
.login-card h1 {
  font-size: 22px;
  color: var(--brand-primary);
  letter-spacing: 2px;
  margin-bottom: 4px;
}
.login-card .subtitle {
  color: var(--brand-text-soft);
  font-size: 11px;
  letter-spacing: 4px;
  font-weight: 500;
}
```

### 主按钮
- Default: bg-primary (#1A3A8A), text-white, rounded-btn (8px), py-3 px-6
- Hover: bg-primary-light (#2E5DD6)
- Active: bg-primary-dark (#0F2456), scale(0.98)
- Disabled: opacity-40, cursor-not-allowed
- Loading: 左侧 spinner，文字变为"处理中..."
- 渐变按钮：`linear-gradient(135deg, var(--brand-primary), var(--brand-accent))`

### 次按钮
- Default: border border-primary text-primary bg-transparent
- Hover: bg-primary/10
- Active: bg-primary-dark/10

### 卡片
- bg-white rounded-card (18px) shadow-lg
- padding: 20px（内容卡片）/ 40px（登录卡片）
- 内部分割：border-t border-[#E8ECF3] 或 gap-4
- box-shadow: 0 30px 80px rgba(15,36,86,.4), 0 0 0 1px rgba(200,208,219,.5)

### 输入框
- bg-white rounded-input (6px) border border-[#E8ECF3]
- Focus: border-primary ring-2 ring-primary/10
- Error: border-red-500 ring-2 ring-red-500/20
- padding: 10px 12px

### 导航栏（Sidebar）
- bg: `linear-gradient(180deg, var(--brand-primary-dark), var(--brand-primary))`
- width: 230px
- 品牌区块：padding 20px 18px, border-bottom rgba(255,255,255,.1)
- logo: width 42px, height 42px, bg rgba(255,255,255,.95), rounded 6px

---

## M5 — Layout Principles

### 间距系统（4px基准）
| Token | 值 | 用途 |
|-------|-----|------|
| space-xs | 4px | 图标与文字间距 |
| space-sm | 8px | 紧凑元素间距 |
| space-md | 12px | 标准元素间距 |
| space-lg | 16px | 区块内间距 |
| space-xl | 24px | 区块间间距 |
| space-2xl | 40px | 登录卡片内间距 |

### 登录页布局
- 全屏高度：min-height 100vh
- 居中布局：flex align-center justify-center
- 登录卡片宽度：440px
- 渐变背景：`linear-gradient(135deg, #0f2456 0%, #1a3a8a 50%, #2e5dd6 100%)`
- 背景光晕：radial-gradient at 20% 20% and 80% 70%

### 主界面布局
- 左侧导航：230px
- 主内容区：flex-1, padding 22px
- 顶部工具栏：padding 14px 20px, rounded 10px

---

## M6 — Depth & Elevation

阴影层级系统：

| Level | 样式 | 用途 |
|-------|------|------|
| L0 | 无阴影 | 默认状态 |
| L1 | shadow-sm (0 2px 8px rgba(15,36,86,.05)) | 卡片默认态 |
| L2 | shadow-md (0 4px 12px rgba(26,58,138,.15)) | 导航栏 |
| L3 | shadow-lg (0 30px 80px rgba(15,36,86,.4)) | 登录卡片、Modal |
| L4 | shadow-xl | 强层级弹窗 |

### 医美场景特殊性
- 登录卡片阴影较重（L3），营造专业品牌感
- 内容卡片阴影较轻（L1），避免压迫感
- 优先用 border 代替阴影来区分层级
- 阴影 opacity 不超过 0.4（登录页除外）

---

## M7 — Do's and Don'ts

### ✅ 正确做法
- 用 Primary 蓝做主操作按钮、导航激活态
- 业绩/成交数据用 Accent 橙高亮，营造正向氛围
- 登录页渐变背景（#0F2456 → #1A3A8A → #2E5DD6）
- 登录卡片融入品牌logo（72×72px，居中显示）
- 品牌名使用 letter-spacing: 2px，体现高端感
- 卡片圆角18px，按钮圆角6-8px

### ❌ 错误做法
- 不要用绿色作为主色调（与医美品牌调性不符）
- 不要用纯黑文字（#000000），用 #1D2841 减少压迫感
- 不要用太小的字体（12px以下正文需避免）
- 不要在登录页使用纯色背景（缺少品牌感）
- 不要删除logo或缩小logo尺寸（品牌识别度不足）
- 不要使用过度阴影（医疗用户不需要"重量感"）

---

## M8 — Responsive Behavior

### 移动端优先
- 设计基于375px宽度的iPhone
- 触控热区最小44×44px
- 输入框最小字号16px（避免iOS自动缩放）

### 断点（必要时）
- sm: 640px（平板横屏）
- lg: 1024px（桌面端）

### 登录页响应式
- 移动端登录卡片宽度：90%（max-width 360px）
- 移动端logo尺寸：60×60px
- 移动端内间距：24px

---

## M9 — Agent Prompt Guide

### 快速颜色参考
- Primary: #1A3A8A
- Primary Light: #2E5DD6
- Primary Dark: #0F2456
- Accent: #E67700
- Background: #F5F9FB
- Surface: #FFFFFF
- Text: #1D2841 / #5A6478 / #999999

### AI 生成提示模板
"请按以下规范生成页面：
- 颜色：Primary #1A3A8A，Accent #E67700，Background #F5F9FB
- 字体：正文16px，行高1.6，品牌名 letter-spacing 2px
- 圆角：卡片18px，按钮6-8px，输入框6px
- 间距：16px区块间距，登录卡片40px内间距
- 阴影：登录卡片 shadow-lg (L3)，内容卡片 shadow-sm (L1)
- logo：登录页72×72px，导航栏42×42px
- 不要：绿色主色调、纯黑文字、纯色登录背景、过度阴影"

### CSS变量速查
```css
:root {
  --brand-primary: #1a3a8a;
  --brand-primary-light: #2e5dd6;
  --brand-primary-dark: #0f2456;
  --brand-accent: #e67700;
  --brand-bg: #f5f9fb;
  --brand-surface: #ffffff;
  --brand-silver: #c8d0db;
  --brand-silver-light: #e8ecf3;
  --brand-text: #1d2841;
  --brand-text-soft: #5a6478;
}
```

---

## 品牌Logo使用规范

### Logo文件位置
- 路径：`public/uploads/logo.jpg`
- 尺寸：93KB，高清版本
- 使用场景：登录页、导航栏、品牌区块

### Logo尺寸规范
| 场景 | 尺寸 | 样式 |
|------|------|------|
| 登录页 | 72×72px | 居中，drop-shadow，margin-bottom 12px |
| 导航栏 | 42×42px | bg rgba(255,255,255,.95)，rounded 6px，padding 3px |
| 其他品牌区块 | 32-48px | 根据上下文调整 |

### Logo周边留白
- 登录页：下方12px，上方无留白
- 导航栏：左右12px，上下居中

---

## 版本记录

- v1.0 (2026-06-30)：初始版本，基于品牌logo提取颜色系统