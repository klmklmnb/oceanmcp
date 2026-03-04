# OceanMCP SDK Integration Guide

OceanMCP is a **Browser-in-the-Loop** AI agent SDK that can be injected into any existing web application. It provides a chat-based AI assistant that can read data from and perform actions on your web app — using the user's authenticated browser session.

This guide walks you through integrating the OceanMCP frontend SDK into your own project.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installation Methods](#installation-methods)
  - [UMD Script Tag (Easiest)](#1-umd-script-tag-easiest)
  - [ES Module Import](#2-es-module-import)
- [Mount Options](#mount-options)
- [Registering Skills](#registering-skills)
- [Registering Standalone Tools](#registering-standalone-tools)
  - [Executor Type (Recommended)](#executor-type-recommended)
  - [Code Type](#code-type)
  - [Parameter Definitions](#parameter-definitions)
- [Registering Skills from a ZIP File](#registering-skills-from-a-zip-file)
- [File Upload](#file-upload)
- [Programmatic Chat Control](#programmatic-chat-control)
- [Unregistering & Cleanup](#unregistering--cleanup)
- [Advanced Usage](#advanced-usage)
- [API Reference](#api-reference)
- [Type Reference](#type-reference)
- [FAQ](#faq)

---

## Quick Start

The fastest way to get OceanMCP running in your app — just add two lines:

```html
<script src="https://your-cdn.com/ocean-mcp/sdk.umd.js"></script>
<script>
  OceanMCPSDK.mount();
</script>
```

That's it! A floating chat widget will appear in the bottom-right corner of your page. The SDK connects to the OceanMCP backend automatically and comes with built-in tools like reading page info and content.

Want to teach the AI about your app's domain? Keep reading to learn how to register custom skills and tools.

---

## Installation Methods

### 1. UMD Script Tag (Easiest)

Best for: legacy projects, quick prototyping, or apps without a JS bundler.

The UMD build (`sdk.umd.js`) is a single self-contained file — CSS is embedded in the JS and injected automatically at mount time. No external stylesheet needed.

```html
<!-- Load the SDK -->
<script src="https://your-cdn.com/ocean-mcp/sdk.umd.js"></script>

<script>
  // Register your custom tools (optional)
  OceanMCPSDK.registerTool({
    id: "getOrderList",
    name: "Get Order List",
    description: "Fetch the list of orders for the current user",
    operationType: "read",
    executor: async (args) => {
      const res = await fetch("/api/orders");
      return res.json();
    },
    parameters: [],
  });

  // Mount the chat widget
  OceanMCPSDK.mount();
</script>
```

### 2. ES Module Import

Best for: modern apps using Vite, Webpack, or other bundlers.

```html
<script type="module">
  import OceanMCPSDK from "https://your-cdn.com/ocean-mcp/sdk.js";

  OceanMCPSDK.mount({ locale: "en-US" });
</script>
```

Or if you host the SDK files locally:

```js
// In your app's entry file
import OceanMCPSDK from "./lib/ocean-mcp/sdk.js";

OceanMCPSDK.registerSkill(mySkill);
OceanMCPSDK.mount({ root: "#chat-container" });
```

---

## Mount Options

The `mount()` method accepts several forms:

```ts
// Auto-create a floating overlay (bottom-right corner)
OceanMCPSDK.mount();

// Mount into a specific element by CSS selector
OceanMCPSDK.mount("#my-chat-container");

// Mount into a specific DOM element
OceanMCPSDK.mount(document.getElementById("chat"));

// Mount with options
OceanMCPSDK.mount({
  root: "#my-chat", // Optional: mount target (string selector or HTMLElement)
  locale: "zh-CN", // Optional: "zh-CN" or "en-US"
  avatar: "/img/bot.png", // Optional: custom avatar URL for the AI
  model: {
    // Optional: LLM model configuration
    default: "gpt-4o",
    maxTokens: 8192,
  },
  theme: "auto", // Optional: UI Theme preference ("light", "dark", or "auto")
  shadowDOM: true, // Optional: style isolation (default: true)
  suggestions: [
    // Optional: custom welcome-screen suggestion questions
    {
      label: "What's on this page?",
      text: "Analyze the current page content in detail",
    },
    {
      label: "Help me debug",
      text: "Look at the console errors and help me fix them",
    },
    { label: "What can you do?" }, // text omitted → sends "What can you do?"
  ],
});
```

### Option Details

| Option        | Type                          | Default                   | Description                                                                                                                                                                                                                                                                                       |
| ------------- | ----------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root`        | `string \| HTMLElement`       | Auto-created floating div | Where to render the widget. If omitted, creates a `420x600px` floating overlay. If `#ocean-mcp-root` exists in the DOM, it will be used automatically.                                                                                                                                            |
| `locale`      | `"zh-CN" \| "en-US"`          | `undefined`               | UI language. When set to `zh-CN`, skill and tool names will display their `cnName` if available. **Reactive** — can be changed at runtime via `sdkConfig.locale`.                                                                                                                                 |
| `avatar`      | `string`                      | `undefined`               | URL for the AI assistant's avatar image in the chat.                                                                                                                                                                                                                                              |
| `theme`       | `"light" \| "dark" \| "auto"` | `"light"`                 | UI Theme preference. Set to `"light"`, `"dark"`, or `"auto"` (follows system preference). **Reactive** — can be changed at runtime via `sdkConfig.theme`.                                                                                                                                         |
| `model`       | `ModelConfig`                 | `undefined`               | LLM model configuration. Controls which model and parameters are used for chat requests. See [Model Configuration](#model-configuration) below.                                                                                                                                                   |
| `shadowDOM`   | `boolean`                     | `true`                    | When `true`, the widget renders inside a Shadow DOM for full CSS isolation — your app's styles won't affect the widget and vice versa. Set to `false` for debugging or in environments where Shadow DOM causes issues.                                                                            |
| `suggestions` | `SuggestionItem[]`            | `undefined`               | Custom suggestion questions displayed on the welcome screen. Each item has a `label` (button display text) and an optional `text` (the message sent when clicked). When provided, replaces the default suggestions entirely. If `text` is omitted, `label` is used as both display and send text. |

**Tip:** If you want the widget to fill a specific area of your page (like a sidebar), create a container with your desired dimensions and pass it as `root`:

```html
<div id="ai-sidebar" style="width: 400px; height: 100vh;"></div>
<script>
  OceanMCPSDK.mount({ root: "#ai-sidebar", locale: "zh-CN" });
</script>
```

### Model Configuration

The `model` option lets your app control which LLM model and parameters are used for chat. This is sent to the API server with every chat request.

```ts
OceanMCPSDK.mount({
  model: {
    default: "gpt-4o", // Primary model for complex tasks
    fast: "gpt-4o-mini", // Lightweight model for simple tasks
    maxTokens: 16384, // Maximum output tokens per response
  },
});
```

All fields are optional. When omitted, the server falls back to its own environment variable defaults, then to built-in defaults.

| Field       | Type     | Default                           | Description                                                                          |
| ----------- | -------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| `default`   | `string` | Server's `LLM_MODEL` env var      | Primary model ID (e.g., `"gpt-4o"`, `"claude-sonnet-4-20250514"`, `"z-ai/glm-4.6"`). |
| `fast`      | `string` | Server's `LLM_FAST_MODEL` env var | Lightweight model for simpler tasks. Falls back to the default model if not set.     |
| `maxTokens` | `number` | Server's `LLM_MAX_TOKENS` env var | Maximum number of output tokens per response.                                        |

**Examples:**

```ts
// Use a specific model with a token limit
OceanMCPSDK.mount({
  model: { default: "z-ai/glm-4.6", maxTokens: 104800 },
});

// Use different models for different task complexities
OceanMCPSDK.mount({
  model: { default: "gpt-4o", fast: "gpt-4o-mini", maxTokens: 8192 },
});

// Only override the default model, let server handle everything else
OceanMCPSDK.mount({
  model: { default: "claude-sonnet-4-20250514" },
});
```

### Suggestion Configuration

The `suggestions` option lets you customise the welcome-screen suggestion buttons. Each item specifies a `label` (the text shown on the button) and an optional `text` (the actual message sent to the AI when clicked). If `text` is omitted, `label` is used as both the display text and the sent message.

When provided, custom suggestions **replace** the default i18n suggestions entirely. If not provided, the built-in defaults are shown (based on the current `locale`).

```ts
OceanMCPSDK.mount({
  suggestions: [
    {
      label: "What's on this page?",
      text: "Analyze the current page content in detail",
    },
    {
      label: "Help me debug",
      text: "Look at the console errors and help me fix them",
    },
    { label: "What can you do?" }, // text omitted → sends "What can you do?"
  ],
});
```

This is useful when you want the suggestion buttons to show short, user-friendly labels while sending more detailed or structured prompts to the AI behind the scenes.

### Runtime Configuration Changes

The `theme` and `locale` options are **reactive** — you can change them at any time after mounting, and the chat widget will update immediately without needing to re-mount.

```ts
// Initial mount
OceanMCPSDK.mount({ root: "#chat", locale: "en-US", theme: "light" });

// Later: switch to Chinese — the entire UI updates instantly
sdkConfig.locale = "zh-CN";

// Later: switch to dark mode — the widget theme changes instantly
sdkConfig.theme = "dark";

// Switch to system-preference-following mode
sdkConfig.theme = "auto";
```

To access `sdkConfig`, import it from the SDK module or use the global reference:

```ts
// ES Module
import { sdkConfig } from "@ocean-mcp/frontend-sdk";

// Or via the global SDK (UMD)
// sdkConfig is exposed as part of the internal API
```

Under the hood, changing `theme` or `locale` dispatches a custom event (`ocean-mcp:theme-change` / `ocean-mcp:locale-change`) on `window`. The chat widget listens for these events and re-renders automatically. This means the update works even when the SDK runs inside a Shadow DOM with a separate module instance.

> **Note:** Other mount options (such as `avatar`, `welcomeTitle`, `welcomeDescription`, `suggestions`) are currently read only at mount time. Changing them on `sdkConfig` after mounting will not update the UI until the next mount. The `model` option takes effect on the next chat request since it is read lazily.

---

## Registering Skills

A **skill** is a bundle of related tools + context instructions. It's the recommended way to teach the AI about a specific domain of your application.

When you register a skill:

- Its `name` and `description` appear in the AI's system prompt catalog
- Its `instructions` are loaded on-demand when the AI decides to use the skill (keeping the context window efficient)
- Its bundled `tools` are registered for browser-side execution and made available to the AI

```ts
OceanMCPSDK.registerSkill({
  // Required fields
  name: "inventory-ops", // Unique identifier
  description:
    "Manage product inventory: " + // When should the AI use this skill?
    "stock levels, transfers, and audits.",
  instructions: `
# Inventory Operations

When handling inventory tasks, follow these guidelines:

## Reading Stock
- Always use \`getStockLevel\` to check current stock before any mutations.
- Stock levels are per-warehouse. Ask the user which warehouse if not specified.

## Updating Stock
- Use \`updateStock\` for manual adjustments.
- Always confirm the quantity change with the user before executing.
`,

  // Optional fields
  cnName: "库存管理", // Chinese display name (used when locale is zh-CN)
  tools: [
    // Tools bundled with this skill
    {
      id: "getStockLevel",
      name: "Get Stock Level",
      cnName: "获取库存",
      description:
        "Get current stock level for a product in a specific warehouse",
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
          description: "Warehouse ID",
          required: true,
        },
        {
          name: "productId",
          type: "string",
          description: "Product SKU",
          required: true,
        },
      ],
    },
    {
      id: "updateStock",
      name: "Update Stock",
      cnName: "更新库存",
      description:
        "Adjust stock level for a product (write operation, requires approval)",
      type: "executor",
      operationType: "write", // Write operations trigger user approval before execution
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
          description: "New stock quantity",
          required: true,
        },
      ],
    },
  ],
});
```

### Writing Good Instructions

The `instructions` field is a Markdown document that tells the AI _how_ to use the skill's tools. Tips:

- Explain the domain context and any business rules
- Describe the correct order of operations (e.g., "always read before write")
- Mention edge cases or constraints
- Keep it concise — the AI loads instructions on-demand, so you don't need to worry about bloating the initial prompt

---

## Registering Standalone Tools

If you just need to add a single tool without the overhead of a full skill, use `registerTool()`.

### Executor Type (Recommended)

The `executor` type lets you register a real JavaScript function. This is the most common and flexible approach:

```ts
OceanMCPSDK.registerTool({
  id: "getUserProfile",
  name: "Get User Profile",
  description: "Fetches the profile of the currently logged-in user",
  type: "executor", // Optional, defaults to "executor"
  operationType: "read", // Optional, defaults to "read"
  executor: async (args) => {
    const res = await fetch("/api/me");
    return res.json();
  },
  parameters: [],
});
```

The executor runs **in the user's browser context**, meaning it has access to:

- The user's cookies and authenticated session
- The full DOM
- Any JavaScript APIs available on the page
- Your app's global state

### Code Type

The `code` type stores the function logic as a string, which is executed via `new Function()`. This is useful for tools that are defined in configuration or fetched from a server:

```ts
OceanMCPSDK.registerTool({
  id: "getClusterList",
  name: "Get Cluster List",
  description: "Fetch the list of Kubernetes clusters",
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

Inside `code` strings, you have access to:

- `args` — the arguments object passed by the AI
- `window`, `document`, `fetch` — standard browser globals

### Read vs. Write Operations

- **`operationType: "read"`** — The tool only reads data. It runs immediately when the AI calls it.
- **`operationType: "write"`** — The tool modifies data. The AI will present a plan to the user for approval before executing. The user sees an "Approve" / "Deny" button in the chat.

### Parameter Definitions

Each tool declares the parameters it accepts. The AI uses these definitions to construct the correct arguments:

```ts
parameters: [
  {
    name: "userId",
    type: "string", // "string" | "number" | "boolean" | "object" | "array"
    description: "The user's unique ID",
    required: true,
  },
  {
    name: "includeHistory",
    type: "boolean",
    description: "Whether to include order history in the response",
    required: false,
  },
];
```

**Advanced parameter options:**

| Field         | Type                           | Description                                                               |
| ------------- | ------------------------------ | ------------------------------------------------------------------------- |
| `name`        | `string`                       | Parameter name (matches the key in `args`)                                |
| `type`        | `string`                       | `"string"`, `"number"`, `"boolean"`, `"object"`, `"array"`                |
| `description` | `string`                       | Tells the AI what this parameter is for                                   |
| `required`    | `boolean`                      | Whether the AI must provide this parameter                                |
| `showName`    | `string`                       | Display name override in the UI (e.g., "User ID" instead of "userId")     |
| `enumMap`     | `Record<string, any>`          | Maps raw values to display labels (e.g., `{ "prod": "Production" }`)      |
| `columns`     | `Record<string, ColumnConfig>` | Column config for array/object params; triggers table rendering in the UI |

---

## Registering Skills from a ZIP File

For skills that are maintained separately or distributed via CDN, you can register them from a `.zip` file:

```ts
const skills = await OceanMCPSDK.registerSkillFromZip(
  "https://cdn.example.com/skills/my-skill-pack.zip",
);
console.log(
  "Registered:",
  skills.map((s) => s.name),
);
```

### ZIP Format

The ZIP is downloaded and processed by the server. Skill discovery follows these rules:

- **Single skill:** If the ZIP root contains a `SKILL.md` file, it's treated as one skill. Subdirectories are treated as resources (scripts, references, etc.), not as separate skills.
- **Multi-skill pack:** If there's no root `SKILL.md`, each subdirectory containing a `SKILL.md` is registered as a separate skill.

### SKILL.md Format

Each `SKILL.md` file should have YAML frontmatter with `name` and `description`, followed by the full instructions in the body:

```markdown
---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, merge documents.
---

# PDF Processing

When the user asks to work with PDF files, use these tools:

## Extracting Text

...
```

---

## File Upload

You can enable file uploads in the chat by registering an upload handler. When registered, a paperclip button appears in the input area.

```ts
OceanMCPSDK.registerUploader(async (files) => {
  // files is a File[] array from the browser's file picker
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const res = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });
  const data = await res.json();

  // Must return an array of UploadResult objects
  return data.map((item, i) => ({
    url: item.url, // Required: URL where the file can be accessed
    name: files[i].name, // Required: file name
    size: files[i].size, // Optional: file size in bytes
    type: files[i].type, // Optional: MIME type
  }));
});
```

The upload results are automatically sent as a user message in the chat, so the AI can reference the uploaded files.

To remove the upload handler (and hide the upload button):

```ts
// Option 1: Use the returned cleanup function
const cleanup = OceanMCPSDK.registerUploader(handler);
cleanup();

// Option 2: Call unregister directly
OceanMCPSDK.unregisterUploader();
```

---

## Programmatic Chat Control

You can control the chat widget from your application code:

```ts
// Send a message as if the user typed it
await OceanMCPSDK.chat("What's on this page?");

// Set the input box text without sending
await OceanMCPSDK.setInput("draft message...");

// Get all current chat messages
const messages = await OceanMCPSDK.getMessages();

// Clear all chat messages
await OceanMCPSDK.clearMessages();
```

This is useful for:

- Creating shortcut buttons that trigger specific AI queries
- Pre-filling the chat input based on user context
- Building custom chat UI that wraps the SDK

---

## Unregistering & Cleanup

```ts
// Unregister a specific tool
OceanMCPSDK.unregisterTool("getOrderList");

// Unregister a skill and all its bundled tools
OceanMCPSDK.unregisterSkill("inventory-ops");

// Remove upload handler
OceanMCPSDK.unregisterUploader();
```

---

## Advanced Usage

For advanced scenarios, the SDK exposes internal registries and the WebSocket client:

```ts
// Direct access to the function registry
const allTools = OceanMCPSDK.functionRegistry.getAll();
const tool = OceanMCPSDK.functionRegistry.get("myToolId");

// Direct access to the skill registry
const allSkills = OceanMCPSDK.skillRegistry.getAll();
const skill = OceanMCPSDK.skillRegistry.get("my-skill");

// WebSocket client status
const isConnected = OceanMCPSDK.wsClient.isConnected;
const connectionId = OceanMCPSDK.wsClient.currentConnectionId;
```

---

## API Reference

| Method                      | Returns                    | Description                                                                    |
| --------------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `mount(target?)`            | `void`                     | Mount the chat widget. Accepts a CSS selector, HTMLElement, or options object. |
| `registerSkill(definition)` | `void`                     | Register a skill with metadata, instructions, and bundled tools.               |
| `unregisterSkill(name)`     | `void`                     | Remove a skill and its bundled tools.                                          |
| `registerSkillFromZip(url)` | `Promise<SkillMetadata[]>` | Register skill(s) from a CDN-hosted ZIP file.                                  |
| `registerTool(definition)`  | `void`                     | Register a standalone tool.                                                    |
| `unregisterTool(id)`        | `void`                     | Remove a standalone tool.                                                      |
| `getTools()`                | `FunctionDefinition[]`     | Get all registered tools.                                                      |
| `getSkills()`               | `SkillDefinition[]`        | Get all registered skills.                                                     |
| `registerUploader(handler)` | `() => void`               | Register a file upload handler. Returns a cleanup function.                    |
| `unregisterUploader()`      | `void`                     | Remove the file upload handler.                                                |
| `chat(text)`                | `Promise<void>`            | Send a chat message programmatically.                                          |
| `setInput(text)`            | `Promise<void>`            | Set the input box text without sending.                                        |
| `getMessages()`             | `Promise<any[]>`           | Get all current chat messages.                                                 |
| `clearMessages()`           | `Promise<void>`            | Clear all chat messages.                                                       |

---

## Type Reference

### SkillDefinition

```ts
interface SkillDefinition {
  name: string; // Unique skill identifier
  cnName?: string; // Chinese display name (for zh-CN locale)
  description: string; // When to use this skill (shown in AI catalog)
  instructions: string; // Full Markdown instructions (loaded on-demand)
  tools?: FunctionDefinition[]; // Bundled tool definitions
}
```

### FunctionDefinition

```ts
// Executor type — a real JS function
interface ExecutorFunctionDefinition {
  id: string;
  name: string;
  cnName?: string;
  description: string;
  type: "executor";
  operationType: "read" | "write";
  executor: (args: Record<string, any>) => Promise<any>;
  parameters: ParameterDefinition[];
}

// Code type — a code string executed via new Function()
interface CodeFunctionDefinition {
  id: string;
  name: string;
  cnName?: string;
  description: string;
  type: "code";
  operationType: "read" | "write";
  code: string;
  parameters: ParameterDefinition[];
}
```

### ParameterDefinition

```ts
interface ParameterDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required: boolean;
  showName?: string; // Display name in UI
  enumMap?: Record<string, any>; // Value → display label mapping
  columns?: Record<string, ColumnConfig>; // Table rendering config for array params
}

interface ColumnConfig {
  label?: string; // Column header label
  render?: (value: any, row: Record<string, any>) => any; // Custom cell renderer
}
```

### UploadResult

```ts
interface UploadResult {
  url: string; // Required: accessible URL for the uploaded file
  name: string; // Required: file name
  size?: number; // Optional: size in bytes
  type?: string; // Optional: MIME type
}
```

### ModelConfig

```ts
interface ModelConfig {
  default?: string; // Primary model ID (e.g. "gpt-4o", "claude-sonnet-4-20250514")
  fast?: string; // Lightweight model ID for simple tasks
  maxTokens?: number; // Maximum output tokens per response
}
```

### SuggestionItem

```ts
interface SuggestionItem {
  label: string; // Text displayed on the suggestion button
  text?: string; // Message sent to the AI when clicked (defaults to label if omitted)
}
```

---

## FAQ

### My app uses an iframe. Will OceanMCP work?

The SDK mounts into the page where the script is loaded. If your app runs inside an iframe, load the SDK script inside that iframe. Cross-origin iframes will need their own SDK instance.

### Will the SDK's CSS affect my app?

By default, no. The SDK renders inside a **Shadow DOM**, which provides complete CSS isolation in both directions. If you need to disable this (e.g., for debugging), set `shadowDOM: false` in the mount options — but be aware that styles may then interact.

### How does authentication work?

Tools run in the user's browser with full access to cookies and the authenticated session. When a tool calls `fetch("/api/something", { credentials: "include" })`, it uses the user's existing auth. No additional auth setup is needed.

### Can I use this with React / Vue / Angular?

Yes. The SDK is framework-agnostic at the integration level. It mounts its own React root inside a Shadow DOM, so it won't conflict with your app's framework. Just load the UMD script or ES module and call `mount()`.

### What's the difference between a skill and a tool?

A **tool** is a single function the AI can call (e.g., "Get Order List"). A **skill** is a higher-level concept that bundles related tools together with context instructions and metadata. Skills help the AI understand _when_ and _how_ to use a group of tools.

For simple integrations, standalone tools are fine. For complex domains with multiple related operations, use skills.
