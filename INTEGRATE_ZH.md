# OceanMCP SDK 接入文档

OceanMCP 是一个 **Browser-in-the-Loop**（浏览器参与的）AI 智能体 SDK，可以注入到任何现有的 Web 应用中。它提供了一个聊天式 AI 助手，能够利用用户当前的浏览器会话来读取数据和执行操作。

本文档将引导你将 OceanMCP 前端 SDK 集成到你自己的项目中。

---

## 目录

- [快速开始](#快速开始)
- [安装方式](#安装方式)
  - [UMD 脚本标签（最简单）](#1-umd-脚本标签最简单)
  - [ES Module 导入](#2-es-module-导入)
- [挂载选项](#挂载选项)
- [服务器地址配置](#服务器地址配置)
- [注册技能（Skill）](#注册技能skill)
- [注册独立工具（Tool）](#注册独立工具tool)
  - [Executor 类型（推荐）](#executor-类型推荐)
  - [Code 类型](#code-类型)
  - [参数定义](#参数定义)
- [从 ZIP 文件注册技能](#从-zip-文件注册技能)
- [文件上传](#文件上传)
- [编程式聊天控制](#编程式聊天控制)
- [注销与清理](#注销与清理)
- [高级用法](#高级用法)
- [API 参考](#api-参考)
- [类型参考](#类型参考)
- [TypeScript 支持](#typescript-支持)
  - [ESM（打包工具项目）](#esm打包工具项目)
  - [UMD（脚本标签项目）](#umd脚本标签项目)
- [常见问题](#常见问题)

---

## 快速开始

把 OceanMCP 跑起来最快只需要两行代码：

```html
<script src="https://your-cdn.com/ocean-mcp/sdk.umd.js"></script>
<script>
  OceanMCPSDK.mount();
</script>
```

搞定！页面右下角会出现一个浮动的聊天窗口。SDK 会自动连接 OceanMCP 后端服务，并内置了一些基础工具（比如获取页面信息、读取页面内容等）。

想让 AI 了解你应用的业务场景？继续往下看，学习如何注册自定义技能和工具。

---

## 安装方式

### 1. UMD 脚本标签（最简单）

适用于：传统项目、快速原型、或者没有 JS 打包工具的应用。

UMD 构建产物 (`sdk.umd.js`) 是一个独立文件 —— CSS 已嵌入 JS 中，挂载时会自动注入，不需要额外引入样式文件。

```html
<!-- 加载 SDK -->
<script src="https://your-cdn.com/ocean-mcp/sdk.umd.js"></script>

<script>
  // 注册你的自定义工具（可选）
  OceanMCPSDK.registerTool({
    id: "getOrderList",
    name: "Get Order List",
    cnName: "获取订单列表",
    description: "获取当前用户的订单列表",
    operationType: "read",
    executor: async (args) => {
      const res = await fetch("/api/orders");
      return res.json();
    },
    parameters: [],
  });

  // 挂载聊天组件
  OceanMCPSDK.mount();
</script>
```

### 2. ES Module 导入

适用于：使用 Vite、Webpack 或其他打包工具的现代应用。TypeScript 类型开箱即用——详见 [TypeScript 支持](#typescript-支持)。

```html
<script type="module">
  import OceanMCPSDK from "https://your-cdn.com/ocean-mcp/sdk.esm.js";

  OceanMCPSDK.mount({ locale: "zh-CN" });
</script>
```

或者把 SDK 文件放到本地：

```js
// 在你的应用入口文件中
import OceanMCPSDK from "./lib/ocean-mcp/sdk.esm.js";

OceanMCPSDK.registerSkill(mySkill);
OceanMCPSDK.mount({ root: "#chat-container" });
```

---

## 挂载选项

`mount()` 方法支持多种调用方式：

```ts
// 自动创建浮动窗口（页面右下角）
OceanMCPSDK.mount();

// 通过 CSS 选择器挂载到指定元素
OceanMCPSDK.mount("#my-chat-container");

// 挂载到指定的 DOM 元素
OceanMCPSDK.mount(document.getElementById("chat"));

// 传入配置对象
OceanMCPSDK.mount({
  root: "#my-chat", // 可选：挂载目标（CSS 选择器或 HTMLElement）
  locale: "zh-CN", // 可选："zh-CN" 或 "en-US"
  avatar: "/img/bot.png", // 可选：AI 助手的自定义头像 URL
  model: {
    // 可选：LLM 模型配置
    default: "gpt-4o",
    maxTokens: 8192,
  },
  theme: "auto", // 可选：UI 主题偏好 ("light", "dark", 或 "auto")
  shadowDOM: true, // 可选：样式隔离（默认开启）
  suggestions: [
    // 可选：自定义欢迎页建议问题
    { label: "这个页面有什么？", text: "请详细分析当前页面的内容" },
    { label: "帮我调试", text: "查看控制台错误并帮我修复它们" },
    { label: "你能做什么？" }, // 省略 text → 发送 "你能做什么？"
  ],
  session: {
    enable: true, // 可选：开启会话持久化与内置斜杠命令
    namespace: "my-app", // 可选：同源多应用下的存储隔离命名空间
    maxSessions: 1000, // 可选：每个命名空间最多保留的会话数量，0 表示无限制
  },
});
```

### 选项详情

| 选项          | 类型                          | 默认值           | 说明                                                                                                                                                                                |
| ------------- | ----------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root`        | `string \| HTMLElement`       | 自动创建浮动 div | 组件渲染位置。如果不传，会创建一个 `420x600px` 的浮动窗口。如果页面中存在 `#ocean-mcp-root` 元素，会自动使用它。                                                                    |
| `locale`      | `"zh-CN" \| "en-US"`          | `undefined`      | 界面语言。设为 `zh-CN` 时，技能和工具会优先显示 `cnName`。**响应式** —— 可通过 `sdkConfig.locale` 运行时动态修改。                                                                    |
| `avatar`      | `string`                      | `undefined`      | AI 助手在聊天中显示的头像图片 URL。                                                                                                                                                 |
| `theme`       | `"light" \| "dark" \| "auto"` | `undefined`      | UI 主题偏好。可设置为 `"light"`、`"dark"` 或 `"auto"`（跟随系统偏好）。未设置（`undefined`）时默认使用浅色主题。**响应式** —— 可通过 `sdkConfig.theme` 运行时动态修改。              |
| `model`       | `ModelConfig`                 | `undefined`      | LLM 模型配置。控制聊天请求使用的模型和参数。详见下方[模型配置](#模型配置)。                                                                                                         |
| `session`     | `SessionOptions`              | `{ enable: true }` | 会话持久化选项。默认开启；如需关闭请设置 `session: { enable: false }`。`enable: true` 时开启本地会话存储，并启用内置斜杠命令（`/new`、`/sessions`）。`namespace` 用于同源多应用的数据隔离。`maxSessions` 为软限制（默认 1000，0 表示无限制），仅在新建会话时裁剪历史记录。 |
| `shadowDOM`   | `boolean`                     | `true`           | 为 `true` 时，组件在 Shadow DOM 内渲染，实现完全的 CSS 隔离——你的应用样式不会影响组件，组件样式也不会影响你的应用。设为 `false` 可用于调试，但要注意样式可能会互相影响。            |
| `suggestions` | `SuggestionItem[]`            | `undefined`      | 自定义欢迎页建议问题。每个条目包含 `label`（按钮显示文本）和可选的 `text`（点击时实际发送的消息）。设置后会完全替换默认的建议问题。如果省略 `text`，则 `label` 同时用于显示和发送。 |

**小贴士：** 如果你想让组件填满页面的某个区域（比如侧边栏），创建一个有你期望尺寸的容器，然后把它作为 `root` 传入：

```html
<div id="ai-sidebar" style="width: 400px; height: 100vh;"></div>
<script>
  OceanMCPSDK.mount({ root: "#ai-sidebar", locale: "zh-CN" });
</script>
```

### 模型配置

`model` 选项让你的应用控制聊天使用的 LLM 模型和参数。配置会随每次聊天请求发送到 API 服务器。

```ts
OceanMCPSDK.mount({
  model: {
    default: "gpt-4o", // 主模型，用于复杂任务
    fast: "gpt-4o-mini", // 轻量模型，用于简单任务
    maxTokens: 16384, // 每次响应的最大输出 token 数
  },
});
```

所有字段都是可选的。未设置时，服务器会依次使用自身的环境变量默认值，然后使用内置默认值。

| 字段        | 类型     | 默认值                           | 说明                                                                         |
| ----------- | -------- | -------------------------------- | ---------------------------------------------------------------------------- |
| `default`   | `string` | 服务器 `LLM_MODEL` 环境变量      | 主模型 ID（如 `"gpt-4o"`、`"claude-sonnet-4-20250514"`、`"mihoyo-glm-4.6"`）。 |
| `fast`      | `string` | 服务器 `LLM_FAST_MODEL` 环境变量 | 轻量模型，用于较简单的任务。未设置时回退到默认模型。                         |
| `maxTokens` | `number` | 服务器 `LLM_MAX_TOKENS` 环境变量 | 每次响应的最大输出 token 数。                                                |

**示例：**

```ts
// 使用指定模型并设置 token 上限
OceanMCPSDK.mount({
  model: { default: "mihoyo-glm-4.6", maxTokens: 104800 },
});

// 对不同复杂度的任务使用不同模型
OceanMCPSDK.mount({
  model: { default: "gpt-4o", fast: "gpt-4o-mini", maxTokens: 8192 },
});

// 只覆盖默认模型，其余交给服务器处理
OceanMCPSDK.mount({
  model: { default: "claude-sonnet-4-20250514" },
});
```

### 建议配置

`suggestions` 选项让你自定义欢迎页面上的建议按钮。每个条目指定一个 `label`（按钮上显示的文本）和可选的 `text`（点击时实际发送给 AI 的消息）。如果省略 `text`，则 `label` 同时用作显示文本和发送消息。

设置后，自定义建议会**完全替换**默认的国际化建议。如果不设置，则显示内置的默认建议（基于当前 `locale`）。

```ts
OceanMCPSDK.mount({
  suggestions: [
    { label: "这个页面有什么？", text: "请详细分析当前页面的内容" },
    { label: "帮我调试", text: "查看控制台错误并帮我修复它们" },
    { label: "你能做什么？" }, // 省略 text → 发送 "你能做什么？"
  ],
});
```

这在你希望建议按钮显示简短、用户友好的标签，同时在幕后向 AI 发送更详细或结构化的提示时非常有用。

### Session 配置

Session 能力通过 `session` 选项开启：

```ts
OceanMCPSDK.mount({
  session: {
    enable: true,
    namespace: "my-app",
    maxSessions: 1000,
  },
});
```

`SessionOptions` 字段：

- `enable`（`boolean`）：开启或关闭会话持久化
- `namespace?`（`string`）：可选命名空间，用于同源下多应用数据隔离
- `maxSessions?`（`number`）：每个命名空间最多保留的会话数量。默认 1000；`0` 表示无限制。为软限制，仅在新建会话时进行裁剪。

开启后的行为：

- 会话保存在 IndexedDB（`ocean-mcp-sessions` + 可选 `:${namespace}`）
- 内置斜杠命令 `/new` 和 `/sessions` 可用
- 会话采用懒创建：空草稿态不落库
- 只有有消息需要保存时才会创建持久化会话
- 会话数量限制为软限制，仅在新建会话时裁剪历史记录

### 运行时动态变更配置

`theme` 和 `locale` 选项是**响应式**的——挂载后可以随时修改，聊天组件会立即更新，无需重新挂载。

```ts
// 初始挂载
OceanMCPSDK.mount({ root: "#chat", locale: "en-US", theme: "light" });

// 之后：切换为中文 —— 整个 UI 立即更新
sdkConfig.locale = "zh-CN";

// 之后：切换为暗黑模式 —— 组件主题立即变化
sdkConfig.theme = "dark";

// 切换为跟随系统偏好模式
sdkConfig.theme = "auto";
```

要访问 `sdkConfig`，可以从 SDK 模块导入或使用全局引用：

```ts
// ES Module
import { sdkConfig } from "@ocean-mcp/frontend-sdk";

// 或者通过全局 SDK（UMD 方式）
// sdkConfig 作为内部 API 的一部分暴露
```

底层原理：修改 `theme` 或 `locale` 时，setter 会在 `window` 上派发自定义事件（`ocean-mcp:theme-change` / `ocean-mcp:locale-change`）。聊天组件监听这些事件并自动重渲染。即使 SDK 运行在 Shadow DOM 中存在独立模块实例的情况下，这种跨实例通信机制也能正常工作。

> **注意：** 其他挂载选项（如 `avatar`、`welcomeTitle`、`welcomeDescription`、`suggestions`）目前仅在挂载时读取。挂载后修改 `sdkConfig` 上的这些属性不会更新 UI，直到下一次挂载。`model` 选项会在下一次聊天请求时生效，因为它是延迟读取的。

---

## 服务器地址配置

默认情况下，SDK 连接到 `http://localhost:4000` 上的 OceanMCP API 服务器。在生产或测试环境中，你需要将 SDK 指向你实际部署的服务器地址。

服务器地址按以下优先级解析：

1. **运行时覆盖** — `window.__OCEAN_MCP_SERVER_URL__`（最高优先级）
2. **构建时环境变量** — `VITE_API_URL`（Vite 构建时写入）
3. **兜底默认值** — `http://localhost:4000`

### 运行时设置服务器地址

在加载 SDK 脚本**之前**设置 `window.__OCEAN_MCP_SERVER_URL__`。这是宿主应用推荐的方式，因为不需要重新构建 SDK：

```html
<script>
  // 将 SDK 指向你的 OceanMCP API 服务器（不要带尾部斜杠）
  window.__OCEAN_MCP_SERVER_URL__ = "https://ocean-mcp-api.example.com";
</script>

<!-- 然后加载并挂载 SDK -->
<script src="https://your-cdn.com/ocean-mcp/sdk.umd.js"></script>
<script>
  OceanMCPSDK.mount();
</script>
```

ES Module 方式：

```html
<script>
  window.__OCEAN_MCP_SERVER_URL__ = "https://ocean-mcp-api.example.com";
</script>
<script type="module">
  import OceanMCPSDK from "https://your-cdn.com/ocean-mcp/sdk.esm.js";
  OceanMCPSDK.mount();
</script>
```

### 构建时设置服务器地址

如果你从源码构建 SDK（比如开发阶段或自定义构建），可以通过 `VITE_API_URL` 环境变量来设置。通常通过 `.env` 文件配置：

```bash
# .env.production
VITE_API_URL=https://ocean-mcp-api.example.com

# .env.development（本地开发默认值）
VITE_API_URL=http://localhost:4000
```

构建时的值会写入到打包产物中，在没有运行时覆盖的情况下使用。

### 工作原理

SDK 使用解析后的地址进行 HTTP API 请求（如 `/api/chat`）和 WebSocket 连接（`http(s)://` 协议会自动转换为 `ws(s)://`，连接到 `/connect` 端点）。也就是说，只需配置一个 URL 就能同时覆盖两种通信方式。

> **注意：** 地址末尾不要加斜杠。例如，使用 `https://ocean-mcp-api.example.com` 而不是 `https://ocean-mcp-api.example.com/`。

---

## 注册技能（Skill）

**技能**是一组相关工具 + 上下文指令的集合。这是教 AI 理解你应用业务领域的推荐方式。

注册技能后：

- 它的 `name` 和 `description` 会出现在 AI 的系统提示词技能目录中
- 它的 `instructions` 会在 AI 决定使用该技能时按需加载（保持上下文窗口高效）
- 它绑定的 `tools` 会被注册到浏览器端执行，同时对 AI 可用

```ts
OceanMCPSDK.registerSkill({
  // 必填字段
  name: "inventory-ops", // 唯一标识符
  description: "管理产品库存：库存水平、调拨和盘点。", // AI 什么时候应该用这个技能？
  instructions: `
# 库存操作

处理库存任务时，请遵循以下规则：

## 查询库存
- 在任何写操作之前，必须先使用 \`getStockLevel\` 查询当前库存。
- 库存按仓库维度管理。如果用户未指定仓库，请询问。

## 更新库存
- 使用 \`updateStock\` 进行手动调整。
- 执行前务必与用户确认数量变更。
`,

  // 可选字段
  cnName: "库存管理", // 中文显示名称（locale 为 zh-CN 时使用）
  tools: [
    // 绑定的工具
    {
      id: "getStockLevel",
      name: "Get Stock Level",
      cnName: "获取库存",
      description: "获取指定仓库中某个产品的当前库存水平",
      type: "executor",
      operationType: "read",
      executor: async (args) => {
        const res = await fetch(
          `/api/warehouses/${args.warehouseId}/stock/${args.productId}`,
        );
        return res.json();
      },
      parameters: [
        {
          name: "warehouseId",
          type: "string",
          description: "仓库 ID",
          required: true,
        },
        {
          name: "productId",
          type: "string",
          description: "产品 SKU",
          required: true,
        },
      ],
    },
    {
      id: "updateStock",
      name: "Update Stock",
      cnName: "更新库存",
      description: "调整产品库存水平（写操作，需要用户审批）",
      type: "executor",
      operationType: "write", // 写操作会在执行前触发用户审批
      executor: async (args) => {
        const res = await fetch(
          `/api/warehouses/${args.warehouseId}/stock/${args.productId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quantity: args.quantity }),
          },
        );
        return res.json();
      },
      parameters: [
        { name: "warehouseId", type: "string", required: true },
        { name: "productId", type: "string", required: true },
        {
          name: "quantity",
          type: "number",
          description: "新的库存数量",
          required: true,
        },
      ],
    },
  ],
});
```

### 如何写好 Instructions

`instructions` 字段是一个 Markdown 文档，告诉 AI *如何*使用该技能的工具。建议：

- 解释业务领域的背景和业务规则
- 描述正确的操作顺序（比如"写操作前必须先读"）
- 提及边界情况或约束条件
- 保持简洁——AI 会按需加载 instructions，不用担心初始提示词膨胀

---

## 注册独立工具（Tool）

如果你只需要添加单个工具，不需要完整技能的额外开销，使用 `registerTool()`。

### Executor 类型（推荐）

`executor` 类型让你注册一个真正的 JavaScript 函数。这是最常用也最灵活的方式：

```ts
OceanMCPSDK.registerTool({
  id: "getUserProfile",
  name: "Get User Profile",
  cnName: "获取用户信息",
  description: "获取当前登录用户的个人信息",
  type: "executor", // 可选，默认为 "executor"
  operationType: "read", // 可选，默认为 "read"
  executor: async (args) => {
    const res = await fetch("/api/me");
    return res.json();
  },
  parameters: [],
});
```

executor 函数运行在**用户的浏览器上下文**中，这意味着它可以访问：

- 用户的 Cookie 和已认证的会话
- 完整的 DOM
- 页面上可用的所有 JavaScript API
- 你应用的全局状态

### Code 类型

`code` 类型将函数逻辑存储为字符串，通过 `new Function()` 执行。适合工具定义来自配置文件或远程获取的场景：

```ts
OceanMCPSDK.registerTool({
  id: "getClusterList",
  name: "Get Cluster List",
  cnName: "获取集群列表",
  description: "获取 Kubernetes 集群列表",
  type: "code",
  operationType: "read",
  code: `
    return fetch("/api/clusters", {
      headers: { "Accept": "application/json" },
      credentials: "include",
    })
    .then(response => response.json())
    .then(res => res.data);
  `,
  parameters: [],
});
```

在 `code` 字符串中，你可以访问：

- `args` —— AI 传入的参数对象
- `window`、`document`、`fetch` —— 标准浏览器全局对象

### 读操作 vs 写操作

- **`operationType: "read"`** —— 工具只读取数据。AI 调用时会立即执行。
- **`operationType: "write"`** —— 工具会修改数据。AI 会先向用户展示执行计划，等待审批后再执行。用户会在聊天中看到"批准"/"拒绝"按钮。

#### 写操作的自动审批

如果你希望某个写操作工具无需用户确认就能立即执行（像读操作一样），可以设置 `autoApprove: true`：

```ts
OceanMCPSDK.registerTool({
  id: "addLogEntry",
  name: "Add Log Entry",
  cnName: "添加日志",
  description: "向审计日志追加一条记录",
  type: "executor",
  operationType: "write",
  autoApprove: true,   // 跳过审批流程 —— 直接执行
  executor: async (args) => {
    const res = await fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: args.message }),
    });
    return res.json();
  },
  parameters: [
    { name: "message", type: "string", description: "日志消息", required: true },
  ],
});
```

> **请谨慎使用：** `autoApprove` 会绕过通常让用户在执行前审查写操作的安全机制。仅在低风险的修改操作中启用，即用户确认不会带来额外价值的场景。

### 参数定义

每个工具声明它接受的参数。AI 使用这些定义来构造正确的调用参数。支持两种格式：

#### 格式一：数组格式（简单）

扁平数组格式是最简单的参数定义方式：

```ts
parameters: [
  {
    name: "userId",
    type: "string", // "string" | "number" | "boolean" | "object" | "array"
    description: "用户的唯一 ID",
    required: true,
  },
  {
    name: "includeHistory",
    type: "boolean",
    description: "是否在返回结果中包含订单历史",
    required: false,
  },
];
```

**数组格式参数选项：**

| 字段          | 类型                           | 说明                                                       |
| ------------- | ------------------------------ | ---------------------------------------------------------- |
| `name`        | `string`                       | 参数名称（对应 `args` 中的键名）                           |
| `type`        | `string`                       | `"string"`、`"number"`、`"boolean"`、`"object"`、`"array"` |
| `description` | `string`                       | 告诉 AI 这个参数是做什么的                                 |
| `required`    | `boolean`                      | AI 是否必须提供此参数                                      |
| `showName`    | `string`                       | 在 UI 中显示的名称覆盖（比如显示"用户ID"而不是"userId"）   |
| `enumMap`     | `Record<string, any>`          | 将原始值映射为显示标签（比如 `{ "prod": "生产环境" }`）    |
| `columns`     | `Record<string, ColumnConfig>` | 数组/对象参数的列配置；设置后会在 UI 中以表格形式渲染      |

#### 格式二：JSON Schema（高级）

如果需要更丰富的类型定义——包括嵌套对象、数值约束、字符串正则匹配、数组元素类型、枚举值、默认值等——可以使用标准的 [JSON Schema](https://json-schema.org/)（Draft 7）格式：

```ts
OceanMCPSDK.registerTool({
  id: "calculateShipping",
  name: "Calculate Shipping Cost",
  cnName: "计算运费",
  description: "根据重量和目的地计算运费",
  operationType: "read",
  executor: async (args) => {
    const { weight, destination, express, insurance } = args;
    const baseCost = weight * (express ? 8 : 5) + 10;
    const insuranceFee = insurance?.enabled ? (insurance.value || 0) * 0.02 : 0;
    return { cost: Math.round((baseCost + insuranceFee) * 100) / 100, currency: "CNY" };
  },
  // JSON Schema 格式 —— 一个包含 type: "object" 和 properties 的对象
  parameters: {
    type: "object",
    required: ["weight", "destination"],
    properties: {
      weight: {
        type: "number",
        description: "包裹重量（千克）",
        minimum: 0.1,
        maximum: 50,
      },
      destination: {
        type: "string",
        description: "目的地国家/城市",
      },
      express: {
        type: "boolean",
        description: "是否使用加急物流",
        default: false,
      },
      insurance: {
        type: "object",
        description: "保险选项",
        properties: {
          enabled: {
            type: "boolean",
            description: "是否购买保险",
            default: false,
          },
          value: {
            type: "number",
            description: "物品申报价值（元）",
            minimum: 0,
          },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
});
```

**JSON Schema 相比数组格式的优势：**

| 特性                              | 数组格式       | JSON Schema |
| --------------------------------- | -------------- | ----------- |
| 基本类型                          | 支持           | 支持        |
| 必填/可选                         | 支持           | 支持        |
| 枚举值                            | 通过 `enumMap` | 原生 `enum` |
| 嵌套对象属性                      | 不支持（使用 `z.any()`） | 支持 |
| 数值约束（最小值/最大值）         | 不支持         | 支持        |
| 字符串约束（正则、格式、最小长度）| 不支持         | 支持        |
| 数组元素类型                      | 有限支持       | 支持        |
| 默认值                            | 不支持         | 支持        |
| 联合类型（oneOf/anyOf）           | 不支持         | 支持        |

两种格式完全向后兼容。SDK 会在运行时自动检测格式：如果 `parameters` 是数组，使用数组格式；如果是包含 `type: "object"` 和 `properties` 的对象，使用 JSON Schema 格式。

---

## 从 ZIP 文件注册技能

对于独立维护或通过 CDN 分发的技能，你可以从 `.zip` 文件注册：

```ts
const skills = await OceanMCPSDK.registerSkillFromZip(
  "https://cdn.example.com/skills/my-skill-pack.zip",
);
console.log(
  "已注册:",
  skills.map((s) => s.name),
);
```

### ZIP 格式

ZIP 文件会被下载并在服务器端处理。技能发现遵循以下规则：

- **单个技能：** 如果 ZIP 根目录包含 `SKILL.md` 文件，整个 ZIP 被视为一个技能。子目录被视为资源文件（脚本、参考资料等），不会被当作独立技能。
- **多技能包：** 如果根目录没有 `SKILL.md`，则每个包含 `SKILL.md` 的子目录会被注册为独立技能。

### SKILL.md 格式

每个 `SKILL.md` 文件应包含带有 `name` 和 `description` 的 YAML frontmatter，正文部分是完整的使用说明：

```markdown
---
name: pdf-processing
description: 从 PDF 文件中提取文本和表格，填写表单，合并文档。
---

# PDF 处理

当用户要求处理 PDF 文件时，使用以下工具：

## 提取文本

...
```

---

## 文件上传

通过注册上传处理器，可以在聊天中启用文件上传功能。注册后，输入区域会出现一个附件按钮。

```ts
OceanMCPSDK.registerUploader(async (files) => {
  // files 是浏览器文件选择器返回的 File[] 数组
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });
  const data = await res.json();

  // 必须返回 UploadResult 对象数组
  return data.map((item, i) => ({
    url: item.url, // 必填：文件可访问的 URL
    name: files[i].name, // 必填：文件名
    size: files[i].size, // 可选：文件大小（字节）
    type: files[i].type, // 可选：MIME 类型
  }));
});
```

上传结果会自动作为用户消息发送到聊天中，AI 可以引用上传的文件。

移除上传处理器（同时隐藏上传按钮）：

```ts
// 方式一：使用返回的清理函数
const cleanup = OceanMCPSDK.registerUploader(handler);
cleanup();

// 方式二：直接调用注销方法
OceanMCPSDK.unregisterUploader();
```

---

## 编程式聊天控制

你可以通过代码控制聊天组件：

```ts
// 像用户输入一样发送消息
await OceanMCPSDK.chat("这个页面上有什么？");

// 设置输入框文本，但不发送
await OceanMCPSDK.setInput("草稿消息...");

// 获取当前所有聊天消息
const messages = await OceanMCPSDK.getMessages();

// 清空所有聊天消息
await OceanMCPSDK.clearMessages();
```

适用场景：

- 创建快捷按钮触发特定的 AI 查询
- 根据用户上下文预填充聊天输入
- 构建包装 SDK 的自定义聊天 UI

### 斜杠命令

当 `session.enable` 为 `true` 时，内置斜杠命令可用：

- `/new`：开始一个新的草稿会话
- `/sessions`：打开历史会话面板并切换会话

你也可以注册自定义斜杠命令：

```ts
OceanMCPSDK.registerCommand({
  name: "helpdesk",
  description: "打开工单处理流程",
  execute: async (args) => {
    await OceanMCPSDK.chat(`Helpdesk workflow: ${args ?? "default"}`);
  },
});

OceanMCPSDK.unregisterCommand("helpdesk");
```

---

## 注销与清理

```ts
// 注销特定工具
OceanMCPSDK.unregisterTool("getOrderList");

// 注销技能及其所有绑定的工具
OceanMCPSDK.unregisterSkill("inventory-ops");

// 移除上传处理器
OceanMCPSDK.unregisterUploader();
```

---

## 高级用法

对于高级场景，SDK 暴露了内部注册表和 WebSocket 客户端：

```ts
// 直接访问函数注册表
const allTools = OceanMCPSDK.functionRegistry.getAll();
const tool = OceanMCPSDK.functionRegistry.get("myToolId");

// 直接访问技能注册表
const allSkills = OceanMCPSDK.skillRegistry.getAll();
const skill = OceanMCPSDK.skillRegistry.get("my-skill");

// WebSocket 客户端状态
const isConnected = OceanMCPSDK.wsClient.isConnected;
const connectionId = OceanMCPSDK.wsClient.currentConnectionId;
```

---

## API 参考

| 方法                        | 返回值                     | 说明                                                    |
| --------------------------- | -------------------------- | ------------------------------------------------------- |
| `mount(target?)`            | `void`                     | 挂载聊天组件。接受 CSS 选择器、HTMLElement 或配置对象。 |
| `registerSkill(definition)` | `void`                     | 注册一个技能，包含元数据、使用说明和绑定的工具。        |
| `unregisterSkill(name)`     | `void`                     | 移除一个技能及其绑定的工具。                            |
| `registerSkillFromZip(url)` | `Promise<SkillMetadata[]>` | 从 CDN 托管的 ZIP 文件注册技能。                        |
| `registerTool(definition)`  | `void`                     | 注册一个独立工具。                                      |
| `unregisterTool(id)`        | `void`                     | 移除一个独立工具。                                      |
| `getTools()`                | `FunctionDefinition[]`     | 获取所有已注册的工具。                                  |
| `getSkills()`               | `SkillDefinition[]`        | 获取所有已注册的技能。                                  |
| `registerUploader(handler)` | `() => void`               | 注册文件上传处理器。返回清理函数。                      |
| `unregisterUploader()`      | `void`                     | 移除文件上传处理器。                                    |
| `chat(text)`                | `Promise<void>`            | 编程式发送聊天消息。                                    |
| `setInput(text)`            | `Promise<void>`            | 设置输入框文本，不发送。                                |
| `getMessages()`             | `Promise<any[]>`           | 获取当前所有聊天消息。                                  |
| `clearMessages()`           | `Promise<void>`            | 清空所有聊天消息。                                      |
| `registerCommand(command)`  | `void`                     | 注册自定义斜杠命令。                                    |
| `unregisterCommand(name)`   | `void`                     | 按名称注销斜杠命令。                                    |

---

## 类型参考

### SkillDefinition

```ts
interface SkillDefinition {
  name: string; // 唯一技能标识符
  cnName?: string; // 中文显示名称（zh-CN 下使用）
  description: string; // 何时使用此技能（展示在 AI 技能目录中）
  instructions: string; // 完整的 Markdown 使用说明（按需加载）
  tools?: FunctionDefinition[]; // 绑定的工具定义
}
```

### FunctionDefinition

```ts
// Executor 类型 —— 真正的 JS 函数
interface ExecutorFunctionDefinition {
  id: string;
  name: string;
  cnName?: string;
  description: string;
  type: "executor";
  operationType: "read" | "write";
  autoApprove?: boolean;          // 为 true 时，写操作工具无需用户审批即可执行
  executor: (args: Record<string, any>) => Promise<any>;
  parameters: FunctionParameters; // ParameterDefinition[] 或 JSONSchemaParameters
}

// Code 类型 —— 代码字符串，通过 new Function() 执行
interface CodeFunctionDefinition {
  id: string;
  name: string;
  cnName?: string;
  description: string;
  type: "code";
  operationType: "read" | "write";
  autoApprove?: boolean;          // 为 true 时，写操作工具无需用户审批即可执行
  code: string;
  parameters: FunctionParameters; // ParameterDefinition[] 或 JSONSchemaParameters
}
```

### FunctionParameters

`parameters` 字段接受两种格式：

```ts
// 联合类型 —— 两种格式都可以
type FunctionParameters = ParameterDefinition[] | JSONSchemaParameters;
```

### ParameterDefinition（数组格式）

```ts
interface ParameterDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required: boolean;
  showName?: string; // UI 中的显示名称
  enumMap?: Record<string, any>; // 值 → 显示标签的映射
  columns?: Record<string, ColumnConfig>; // 数组参数的表格渲染配置
}

interface ColumnConfig {
  label?: string; // 列头标签
  render?: (value: any, row: Record<string, any>) => any; // 自定义单元格渲染器
}
```

### JSONSchemaParameters（JSON Schema 格式）

```ts
interface JSONSchemaParameters {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean | JSONSchemaProperty;
  description?: string;
  [key: string]: unknown; // 允许其他 JSON Schema 关键字
}

interface JSONSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: (string | number | boolean | null)[];
  default?: unknown;

  // 字符串约束
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;

  // 数值约束
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;

  // 数组约束
  items?: JSONSchemaProperty;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;

  // 嵌套对象
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean | JSONSchemaProperty;

  // 组合
  oneOf?: JSONSchemaProperty[];
  anyOf?: JSONSchemaProperty[];
  allOf?: JSONSchemaProperty[];
}
```

### UploadResult

```ts
interface UploadResult {
  url: string; // 必填：上传文件的可访问 URL
  name: string; // 必填：文件名
  size?: number; // 可选：文件大小（字节）
  type?: string; // 可选：MIME 类型
}
```

### ModelConfig

```ts
interface ModelConfig {
  default?: string; // 主模型 ID（如 "gpt-4o"、"claude-sonnet-4-20250514"）
  fast?: string; // 轻量模型 ID，用于简单任务
  maxTokens?: number; // 每次响应的最大输出 token 数
}
```

### SuggestionItem

```ts
interface SuggestionItem {
  label: string; // 按钮上显示的文本
  text?: string; // 点击时发送给 AI 的消息（省略时默认使用 label）
}
```

### SessionOptions

```ts
interface SessionOptions {
  enable: boolean;
  namespace?: string;
}
```

### SlashCommand

```ts
interface SlashCommand {
  name: string; // 不带 "/" 前缀的命令名
  description: string;
  execute: (args?: string) => void | Promise<void>;
}
```

---

## TypeScript 支持

SDK 内置了 TypeScript 类型声明，不需要额外安装 `@types/` 包。

### ESM（打包工具项目）

如果你通过 ES Module 导入 SDK，TypeScript 会通过 `package.json` 中的 `types` 字段自动识别类型：

```ts
import OceanMCPSDK from "@ocean-mcp/frontend-sdk";

// 完整的 IntelliSense —— 挂载选项、工具定义等都有类型提示
OceanMCPSDK.mount({ locale: "zh-CN", theme: "dark" });
OceanMCPSDK.registerTool({
  id: "getOrders",
  name: "Get Orders",
  cnName: "获取订单",
  description: "获取订单列表",
  operationType: "read",
  executor: async () => fetch("/api/orders").then((r) => r.json()),
  parameters: [],
});
```

你也可以单独导入类型，用在自己的代码中：

```ts
import type {
  MountOptions,
  FunctionDefinition,
  FunctionParameters,
  JSONSchemaParameters,
  JSONSchemaProperty,
  SkillDefinition,
  SessionOptions,
  SlashCommand,
  ParameterDefinition,
  UploadResult,
  ModelConfig,
} from "@ocean-mcp/frontend-sdk";

const myTool: FunctionDefinition = {
  id: "myTool",
  name: "My Tool",
  cnName: "我的工具",
  description: "做一些事情",
  type: "executor",
  operationType: "read",
  executor: async (args) => ({ result: args.input }),
  parameters: [
    { name: "input", type: "string", description: "输入值", required: true },
  ],
};
```

> **注意：** ESM 的 `.d.ts` 文件引用了 `@ocean-mcp/shared` 中的类型。如果你通过 npm/pnpm 安装 `@ocean-mcp/frontend-sdk`，shared 包会作为依赖自动拉取，不需要额外操作。

### UMD（脚本标签项目）

通过 `<script>` 标签加载 SDK 时，`OceanMCPSDK` 会挂载到 `window` 上。要获得全局变量的类型支持，请在任意 `.ts` 或 `.d.ts` 文件（比如项目的 `typings.d.ts`）中添加三斜线引用：

```ts
/// <reference types="@ocean-mcp/frontend-sdk/sdk.umd" />

// 现在 TypeScript 能识别全局的 `OceanMCPSDK` 了
OceanMCPSDK.mount(); // ✓ 有类型提示
window.OceanMCPSDK.registerTool({ ... }); // ✓ 有类型提示
```

或者在 `tsconfig.json` 中添加：

```jsonc
{
  "compilerOptions": {
    "types": ["@ocean-mcp/frontend-sdk/sdk.umd"]
  }
}
```

UMD 声明文件还重新导出了所有公共类型，所以你可以在 JSDoc 或类型注解中引用它们，无需使用 ESM 导入：

```ts
/** @type {import("@ocean-mcp/frontend-sdk/sdk.umd").MountOptions} */
const options = { locale: "en-US", theme: "auto" };
```

---

## 常见问题

### 我的应用使用了 iframe，OceanMCP 能用吗？

SDK 会挂载到加载脚本的页面中。如果你的应用在 iframe 内运行，需要在该 iframe 内加载 SDK 脚本。跨域 iframe 需要各自独立的 SDK 实例。

### SDK 的 CSS 会影响我的应用吗？

默认不会。SDK 在 **Shadow DOM** 内渲染，提供了双向的完全 CSS 隔离。如果你需要关闭它（比如调试时），可以在挂载选项中设置 `shadowDOM: false`——但要注意这样样式可能会互相干扰。

### 认证是怎么工作的？

工具在用户的浏览器中运行，可以完全访问 Cookie 和已认证的会话。当工具调用 `fetch("/api/something", { credentials: "include" })` 时，使用的是用户现有的认证信息。不需要额外的认证配置。

### 可以和 React / Vue / Angular 一起使用吗？

可以。SDK 在集成层面是框架无关的。它在 Shadow DOM 内挂载自己的 React 根节点，不会与你应用的框架产生冲突。只需加载 UMD 脚本或 ES 模块，然后调用 `mount()` 就行。

### 技能（Skill）和工具（Tool）有什么区别？

**工具**是 AI 可以调用的单个函数（比如"获取订单列表"）。**技能**是一个更高层的概念，它把相关的工具打包在一起，并附带上下文说明和元数据。技能帮助 AI 理解*何时*以及*如何*使用一组工具。

简单的接入场景，用独立工具就够了。对于有多个相关操作的复杂业务场景，建议使用技能。
