<p align="center">
  <img src="https://pub-46b4307a6ac249dda431cdfd7f715021.r2.dev/uploads/oceanmcp.png" width="300" alt="OceanMCP Logo" />
</p>

<p align="center">
  <strong>Browser-in-the-Loop AI Agent SDK</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/oceanmcp"><img src="https://img.shields.io/npm/v/oceanmcp.svg?style=flat-square&color=00b4d8" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/oceanmcp"><img src="https://img.shields.io/npm/dm/oceanmcp.svg?style=flat-square&color=38bdf8" alt="npm downloads" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/klmklmnb/oceanmcp.svg?style=flat-square&color=22c55e" alt="license" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.6+-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=white" alt="React" /></a>
  <a href="https://bun.sh/"><img src="https://img.shields.io/badge/Bun-runtime-f9f1e1?style=flat-square&logo=bun&logoColor=000" alt="Bun" /></a>
  <a href="https://github.com/klmklmnb/oceanmcp/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square" alt="PRs Welcome" /></a>
</p>

<p align="center">
  <a href="./README_ZH.md">中文文档</a> &bull;
  <a href="./INTEGRATE.md">Integration Guide</a> &bull;
  <a href="./INTEGRATE_ZH.md">接入指南</a>
</p>

---

OceanMCP is an embeddable AI chat assistant SDK that executes tools **inside the user's browser** — leveraging the authenticated session, DOM access, and application state that only the frontend has. Instead of giving an LLM server-side API keys, you register lightweight tool functions that run in the browser and let the AI orchestrate them.

## Features

- **Browser-in-the-Loop** &mdash; Tools execute in the user's browser context with full access to cookies, DOM, and app state. No server-side API keys needed.
- **Skill System** &mdash; Bundle related tools with Markdown instructions. Skills are loaded on-demand to keep the LLM context window efficient.
- **Two Tool Formats** &mdash; Register tools as `executor` functions (recommended) or `code` strings. Supports both legacy parameter arrays and JSON Schema definitions.
- **Read/Write Safety** &mdash; Read tools execute immediately; write tools show an approval UI before running. Override with `autoApprove` for low-risk mutations.
- **Custom Tool Rendering** &mdash; Tools can provide `showRender` callbacks (React nodes or framework-agnostic `DOMRenderDescriptor`) to display rich UI inline in the chat.
- **Shadow DOM Isolation** &mdash; The widget renders inside a Shadow DOM by default, ensuring zero CSS interference with your application.
- **Theme Support** &mdash; `light`, `dark`, and `auto` (follows OS preference). Reactive &mdash; change at runtime without re-mounting.
- **Session Persistence** &mdash; Conversations are stored in IndexedDB with namespace isolation. Built-in `/new` and `/sessions` slash commands.
- **Subagent Delegation** &mdash; The main agent can delegate parallel research tasks to autonomous subagents with read-only tool access.
- **File Upload** &mdash; Register an upload handler to enable file attachments in the chat.
- **Framework Agnostic** &mdash; Works with React, Vue, Angular, or vanilla JS. UMD and ESM builds included.
- **TypeScript First** &mdash; Full type definitions ship with the package for both ESM and UMD consumers.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Host Web Application                      │
│                                                                  │
│  ┌──────────────┐   registerSkill()   ┌───────────────────────┐  │
│  │  Your App    │──────────────────►  │   OceanMCP Frontend   │  │
│  │  Code        │   registerTool()    │   SDK                 │  │
│  │              │◄──────────────────  │                       │  │
│  │              │   tool execution    │  ┌─────────────────┐  │  │
│  └──────────────┘   in browser ctx    │  │  Chat Widget    │  │  │
│                                       │  │  (Shadow DOM)   │  │  │
│                                       │  └────────┬────────┘  │  │
│                                       └───────────┼───────────┘  │
│                                                   │ WebSocket     │
└───────────────────────────────────────────────────┼──────────────┘
                                                    │
                                        ┌───────────▼───────────┐
                                        │   OceanMCP API Server  │
                                        │                        │
                                        │  ┌──────────────────┐  │
                                        │  │  LLM Provider    │  │
                                        │  │  (OpenAI / etc)  │  │
                                        │  └──────────────────┘  │
                                        │  ┌──────────────────┐  │
                                        │  │  Skill Discovery │  │
                                        │  └──────────────────┘  │
                                        └────────────────────────┘
```

## Quick Start

### Two-Line Integration (UMD)

```html
<script src="https://cdn.jsdelivr.net/npm/oceanmcp@latest/dist/sdk.umd.js"></script>
<script>
  OceanMCPSDK.mount();
</script>
```

### ES Module

```ts
import OceanMCPSDK from "oceanmcp";

OceanMCPSDK.registerTool({
  id: "getOrderList",
  name: "Get Order List",
  description: "Fetch orders for the current user",
  operationType: "read",
  executor: async () => {
    const res = await fetch("/api/orders", { credentials: "include" });
    return res.json();
  },
  parameters: [],
});

OceanMCPSDK.mount({ locale: "en-US", theme: "auto" });
```

### Register a Skill

```ts
OceanMCPSDK.registerSkill({
  name: "inventory-ops",
  description: "Manage product inventory: stock levels, transfers, and audits.",
  instructions: `
# Inventory Operations
- Always use \`getStockLevel\` before any mutations.
- Stock levels are per-warehouse.
  `,
  tools: [
    {
      id: "getStockLevel",
      name: "Get Stock Level",
      description: "Get stock for a product in a warehouse",
      type: "executor",
      operationType: "read",
      executor: async (args) =>
        fetch(`/api/stock/${args.warehouseId}/${args.productId}`).then((r) =>
          r.json()
        ),
      parameters: {
        type: "object",
        required: ["warehouseId", "productId"],
        properties: {
          warehouseId: { type: "string", description: "Warehouse ID" },
          productId: { type: "string", description: "Product SKU" },
        },
      },
    },
  ],
});
```

## Local Development

```bash
# Install dependencies
bun i

# Start the API server
cd packages/api-server && bun run dev

# Start the frontend SDK dev server (in another terminal)
cd packages/frontend-sdk && bun run dev
```

The demo page will be available at `http://localhost:3001` with interactive examples for Form Building, TODO List management, and React Flow diagram editing &mdash; all driven by the AI through browser-side tools.

## Project Structure

```
oceanmcp/
  packages/
    api-server/      # Backend API server (LLM proxy, WebSocket, skill discovery)
    frontend-sdk/    # Frontend SDK (chat widget, tool registry, skill system)
    shared/          # Shared types and constants
```

## Documentation

| Document | Description |
|----------|-------------|
| [Integration Guide](./INTEGRATE.md) | Full SDK integration guide (English) |
| [SDK 接入指南](./INTEGRATE_ZH.md) | Full SDK integration guide (Chinese) |
| [Type Reference](./INTEGRATE.md#type-reference) | Complete TypeScript type definitions |
| [API Reference](./INTEGRATE.md#api-reference) | All SDK public methods |

## Contributing

We welcome contributions! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

[MIT](./LICENSE) &copy; OceanMCP Contributors
