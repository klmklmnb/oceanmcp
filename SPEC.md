# Project Spec: OceanMCP Monorepo

## 1. Overview

OceanMCP is a "Browser-in-the-Loop" agent designed to be injected into any existing web application. It functions as a bridge, allowing an AI agent to orchestrate tasks using the user's authenticated browser session.

The project is structured as a Monorepo using `bun` workspaces.

## 2. Tech Stack & Repository Structure

- **Monorepo / Package Manager:** `bun` (workspaces)
- **Runtime:** Bun (for all packages – server + build)
- **AI Framework:** Vercel AI SDK (`ai` v6, `@ai-sdk/react`)
- **LLM Providers:** Pluggable — Anthropic, OpenAI, or any OpenAI-compatible private endpoint (via adapter)

### Key Dependencies

| Package                     | Version    | Scope                                  |
| --------------------------- | ---------- | -------------------------------------- |
| `ai`                        | `6.0.37`   | api-server (core Vercel AI SDK)        |
| `@ai-sdk/react`             | `3.0.39`   | frontend-sdk (React hooks: `useChat`)  |
| `@ai-sdk/openai-compatible` | `^2.0.27`  | api-server (private LLM adapter)       |
| `@ai-sdk/provider`          | `^3.0.3`   | api-server (provider interface)        |
| `zod`                       | `^3.25.76` | api-server, shared (schema validation) |
| `react`                     | `19.0.1`   | frontend-sdk                           |
| `react-dom`                 | `19.0.1`   | frontend-sdk                           |
| `tailwindcss`               | `^4.1.13`  | frontend-sdk                           |
| `typescript`                | `^5.6.3`   | all packages                           |

### Directory Structure

```text
/OceanMCP
├── bun.lock
├── package.json            # Workspace root
├── tsconfig.base.json
├── packages/
│   ├── shared/             # Shared types & utilities
│   ├── api-server/         # Bun HTTP + WebSocket server (MCP Host + Chat API + AI Brain)
│   │   ├── src/
│   │   │   ├── routes/     # POST /api/chat, WS /connect
│   │   │   ├── ai/         # Vercel AI SDK: prompts, providers, tool definitions
│   │   │   │   ├── tools/  # tool() definitions (server, browser-proxy, plan)
│   │   │   │   ├── prompts.ts
│   │   │   │   └── providers.ts
│   │   │   └── ws/         # WebSocket connection manager
│   └── frontend-sdk/       # Vite + React (Library Mode)
│       ├── src/
│       │   ├── components/  # Chat UI (Vercel AI SDK `useChat` powered)
│       │   ├── registry/    # Pre-registered function definitions
│       │   └── runtime/     # Execution engine (browser-side tool executor)
```

## 3. Package Specifications

### 3.1. Package: api-server

**Role:** The central hub — HTTP server, WebSocket host, Chat API, **and** AI brain (tool definitions, prompts, providers). There is no separate `agent` package.

**Stack:** Bun, Hono (or native Bun HTTP), `ai` (Vercel AI SDK v6), `@ai-sdk/openai-compatible`, `zod`.

**Responsibility:**

- Hosts the HTTP + WebSocket server.
- Serves the Chat API endpoint compatible with Vercel AI SDK's `useChat` / `DefaultChatTransport`.
- Maintains WebSocket connections to the Browser SDK for executing browser-side tools.
- Contains all AI logic: LLM provider configuration, system prompts, and tool definitions (under `src/ai/`).

**Routes:**

- `POST /api/chat` — Receives chat messages from the frontend SDK → runs the AI agent via Vercel AI SDK `streamText()` → returns a `UIMessageStream` response.
- `WS /connect` — Persistent WebSocket connection to the browser SDK for executing browser-side tools.

**Chat Streaming Flow (mirrors ai-chatbot pattern):**

```ts
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
} from "ai";

// POST /api/chat handler
const stream = createUIMessageStream({
  execute: async ({ writer: dataStream }) => {
    const result = streamText({
      model: getLanguageModel(modelId),
      system: systemPrompt,
      messages: modelMessages,
      tools: mergedTools, // Server tools + browser proxy tools
    });
    dataStream.merge(result.toUIMessageStream());
  },
});

return createUIMessageStreamResponse({ stream });
```

**Events (Server → SDK via WebSocket):**

- `EXECUTE_TOOL`: Request browser-side execution of a registered function.
- `TOOL_RESULT`: Return value from browser-side execution back to server.
- `CHAT_STREAM`: (Optional) Forward AI stream chunks to WS clients if needed.

**LLM Provider Adapter (`src/ai/providers.ts`):**

The system supports **any LLM provider** — brand SDKs (Anthropic, OpenAI) or private/self-hosted endpoints — through a unified adapter layer. All providers are accessed via a single `getLanguageModel(modelId)` function, making the rest of the codebase provider-agnostic.

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { customProvider } from "ai";

// Adapter for private/self-hosted OpenAI-compatible LLM
const privateLLM = createOpenAICompatible({
  name: "private-llm",
  baseURL: process.env.LLM_BASE_URL!, // e.g. https://llm.internal.company.com/v1
  apiKey: process.env.LLM_API_KEY, // optional
  headers: {
    // optional extra headers
    "X-Custom-Auth": process.env.LLM_TOKEN ?? "",
  },
});

// Unified provider: map model IDs → concrete model instances
const provider = customProvider({
  languageModels: {
    default: privateLLM("your-model-name"),
    fast: privateLLM("your-fast-model"),
    // Can also mix in brand SDK models:
    // 'claude':     anthropic('claude-sonnet-4-20250514'),
    // 'gpt4':       openai('gpt-4o'),
  },
  fallbackProvider: privateLLM, // unknown IDs fall through here
});

export function getLanguageModel(modelId: string) {
  return provider.languageModel(modelId);
}
```

**Configuration via environment variables:**

| Variable       | Description                                               | Example                                |
| -------------- | --------------------------------------------------------- | -------------------------------------- |
| `LLM_PROVIDER` | Provider type: `openai-compatible`, `anthropic`, `openai` | `openai-compatible`                    |
| `LLM_BASE_URL` | Base URL for OpenAI-compatible endpoints                  | `https://llm.internal.company.com/v1`  |
| `LLM_API_KEY`  | API key (if required by the provider)                     | `sk-...`                               |
| `LLM_MODEL`    | Default model ID to use                                   | `gpt-4o` or `claude-sonnet-4-20250514` |

This design means:

- Switching from Anthropic to a private LLM is a **config change**, not a code change.
- Multiple providers can coexist — e.g., use a fast private model for reads, Claude for complex planning.
- Any provider exposing an OpenAI-compatible API (vLLM, Ollama, LiteLLM, etc.) works out of the box.

**AI Tool Definitions (under `src/ai/tools/`):**

Uses Vercel AI SDK's `tool()` helper. Tools fall into three categories:

**A. Server-Side Tools (execute on server)**

Standard Vercel AI SDK tools with `execute` function:

```ts
import { tool } from 'ai';
import { z } from 'zod';

export const someServerTool = tool({
  description: 'Does something on the server',
  inputSchema: z.object({ ... }),
  execute: async (input) => { ... },
});
```

**B. Browser-Proxy Tools (execute on browser via WebSocket)**

Tools that proxy execution to the browser SDK. The `execute` function sends a WebSocket message and waits for the result:

```ts
export const browserProxyTool = tool({
  description: "Reads data from the host web app",
  inputSchema: z.object({
    functionId: z.string(),
    arguments: z.record(z.any()),
  }),
  execute: async ({ functionId, arguments: args }) => {
    // Send EXECUTE_TOOL to browser via WS → wait for TOOL_RESULT
    return await executeBrowserTool(functionId, args);
  },
});
```

**C. Write Operations (Flow / Plan Tool with Approval)**

For write/mutation operations, the tool uses `needsApproval: true` to leverage Vercel AI SDK's built-in tool approval flow:

```ts
export const executePlan = tool({
  description: "Execute a multi-step plan with write operations",
  inputSchema: z.object({
    intent: z.string(),
    steps: z.array(
      z.object({
        functionId: z.string(),
        arguments: z.record(z.any()),
        title: z.string(),
      }),
    ),
  }),
  needsApproval: true, // User must approve before execution
  execute: async ({ steps }) => {
    const results = [];
    for (const step of steps) {
      results.push(await executeBrowserTool(step.functionId, step.arguments));
    }
    return results;
  },
});
```

### 3.2. Package: frontend-sdk

**Role:** The UI and Browser-Side Execution Engine.

**Stack:** Vite (Library Mode), React, `@ai-sdk/react` (`useChat`), TailwindCSS.

**Build Output:** A single bundled `sdk.js` and `style.css`.

**Key Modules:**

#### A. Chat Interface (Single-Pane, Inline Tool Rendering)

The SDK uses `useChat` from `@ai-sdk/react` with `DefaultChatTransport` to connect to the api-server's `/api/chat` endpoint. **There is no separate "Flow Visualizer" panel.** Instead, tool calls and flow nodes are rendered **inline within the chat message stream** as tool-call parts, following the Vercel AI SDK pattern from the ai-chatbot demo.

```tsx
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

const { messages, sendMessage, status, addToolApprovalResponse } = useChat({
  transport: new DefaultChatTransport({
    api: "http://localhost:4000/api/chat",
  }),
});
```

**Inline Tool Call Rendering:**

Each message's `parts` array may contain tool-call parts (e.g., `tool-executePlan`, `tool-readData`). The message component renders them inline:

```tsx
// Inside message renderer
{message.parts.map((part) => {
  if (part.type === 'tool-executePlan') {
    // Render flow nodes inline: pending → running → success/failed
    return <FlowNodeCard steps={part.input.steps} state={part.state} />;
  }
  if (part.state === 'approval-requested') {
    return <ApprovalButtons onApprove={...} onDeny={...} />;
  }
  // ...
})}
```

#### B. Function Registry & Dynamic Tool Registration

The registry supports **two types** of function definitions and allows **dynamic registration** from the host application's JavaScript.

**Type Definitions:**

```ts
// A "code" function: stored as a code string, executed via new Function()
type CodeFunctionDefinition = {
  id: string;
  name: string;
  description: string;
  type: "code";
  operationType: "read" | "write";
  code: string; // e.g. "return fetch('/api/v1/cluster/' + args.id)"
  parameters: ParameterDefinition[];
};

// An "executor" function: a real JS function registered by the host app
type ExecutorFunctionDefinition = {
  id: string;
  name: string;
  description: string;
  type: "executor";
  operationType: "read" | "write";
  executor: (args: Record<string, any>) => Promise<any>;
  parameters: ParameterDefinition[];
};

type FunctionDefinition = CodeFunctionDefinition | ExecutorFunctionDefinition;

type ParameterDefinition = {
  name: string;
  type: string;
  description?: string;
  required: boolean;
};
```

**Pre-registered Tools:** Defined in `registry/mockFunctions.ts` (and similar files), bundled with the SDK. These are `CodeFunctionDefinition` entries.

**Dynamic Registration API:**

The host application can register additional tools at runtime via a global SDK API:

```ts
// Host app calls this after injecting the SDK script
window.OceanMCPSDK.registerTool({
  id: "GetUserProfile",
  name: "Get User Profile",
  description: "Fetches the current user profile from the host app API",
  type: "executor", // optional, defaults to 'executor'
  operationType: "read",
  executor: async (args) => {
    const res = await fetch(`/api/users/${args.userId}`);
    return res.json();
  },
  parameters: [{ name: "userId", type: "string", required: true }],
});
```

**Merging:** On each chat request, the SDK collects all registered tools (pre-registered + dynamically registered) and sends the full tool schema list to the server. The server then provides these as `tools` to the Vercel AI SDK `streamText()` call.

#### C. Execution Engine

**For `code` type functions:**

- Sandboxing via `new Function()`.
- Context: passes `window` (for `fetch`, cookies) and `args`.

**For `executor` type functions:**

- Directly invokes the registered `executor` function with `args`.
- The function runs in the host app's JS context with full access to application state, DOM, etc.

**Lifecycle (for write operations with approval):**

1. Server proposes a plan via `executePlan` tool → `needsApproval: true`.
2. Chat UI renders the plan as an inline card with Approve/Deny buttons (via Vercel AI SDK's tool approval parts).
3. User clicks "Approve" → `addToolApprovalResponse({ id, approved: true })`.
4. Server executes the steps → results stream back as tool output parts.
5. Each step's status updates in-line: `pending → running → success / failed`.

## 4. Data Models (Shared)

```ts
// Tool execution request (Server → Browser via WS)
type ExecuteToolRequest = {
  requestId: string;
  functionId: string;
  arguments: Record<string, any>;
};

// Tool execution result (Browser → Server via WS)
type ToolResultResponse = {
  requestId: string;
  functionId: string;
  result?: any;
  error?: string;
};

// Flow Plan (used by executePlan tool)
type FlowPlan = {
  planId: string;
  intent: string;
  steps: FlowStep[];
};

type FlowStep = {
  id: string;
  functionId: string;
  title: string;
  arguments: Record<string, any>;
  status: "pending" | "running" | "success" | "failed";
  result?: any;
};

// Parameter definition (shared between code and executor types)
type ParameterDefinition = {
  name: string;
  type: string;
  description?: string;
  required: boolean;
};
```

## 5. Development Workflow

Start API Server:

```bash
# Root
bun --filter api-server run dev   # Starts Bun HTTP+WS server on 4000
```

Start SDK:

```bash
# Root
bun --filter frontend-sdk run dev  # Vite dev server on 3000
```

Integration:

1. Open existing ItrPlatform (or a test HTML page).
2. Inject: `<script type="module" src="http://localhost:3000/src/main.tsx"></script>` (or the built SDK).
3. Optionally register tools from host app JS:
   ```html
   <script>
     window.OceanMCPSDK.registerTool({ id: 'MyTool', ... });
   </script>
   ```
4. The OceanMCP chat UI appears. All tool calls render inline in the chat.

## 6. Implementation Steps for AI

1. **Scaffold Monorepo:** Initialize `bun` workspace with `package.json` and workspace config.

2. **Setup api-server:** Create Bun HTTP server with `/api/chat` endpoint using Vercel AI SDK `streamText()` + `createUIMessageStream()`. Add WebSocket `/connect` for browser tool proxy. Configure Anthropic Claude provider, system prompts, and all tool definitions (`tool()` helper) under `src/ai/`.

3. **Setup frontend-sdk:**
   - Create the Chat UI using `useChat` from `@ai-sdk/react` with `DefaultChatTransport`.
   - Implement inline tool-call rendering in message components (flow nodes, approval buttons).
   - Implement the Function Registry supporting both `code` and `executor` types.
   - Expose `window.OceanMCPSDK.registerTool()` for dynamic tool registration.
   - Implement the Execution Engine (code string runner + executor invoker).

4. **Connect:** Wire up WebSocket flow – server sends `EXECUTE_TOOL` to browser → browser executes → sends `TOOL_RESULT` back → server returns tool result to LLM.
