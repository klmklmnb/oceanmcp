# HackerAgent

A "Browser-in-the-Loop" DevOps agent designed to be injected into web applications. It allows an AI agent to orchestrate tasks using the user's authenticated browser session.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend SDK                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Chat UI    │  │ Flow Viewer  │  │  Function Registry   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                              │                                   │
│                    ┌─────────┴─────────┐                        │
│                    │  Execution Engine  │                        │
│                    └───────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                         WebSocket
                              │
┌─────────────────────────────────────────────────────────────────┐
│                        MCP Server                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   WS Hub     │  │ HTTP Router  │  │   Session Store      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │
┌─────────────────────────────────────────────────────────────────┐
│                          Agent                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   LangChain  │  │   ReadTool   │  │      PlanTool        │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- Bun (for mcp-server)
- Anthropic API key

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### Development

```bash
# Start all services (server, agent, SDK)
pnpm dev

# Or start individually:
pnpm dev:server  # MCP Server on port 4000
pnpm dev:agent   # Agent service
pnpm dev:sdk     # Frontend SDK on port 3000
```

### Usage

1. Start the development servers
2. Open http://localhost:3000 in your browser
3. Press `Ctrl+K` (or `Cmd+K` on Mac) to open HackerAgent
4. Start chatting!

### Injecting into Existing Apps

Add this script tag to your HTML:

```html
<script type="module" src="http://localhost:3000/src/main.tsx"></script>
```

Or for production, use the built SDK:

```html
<script src="path/to/sdk.js"></script>
```

## Packages

### @hacker-agent/mcp-server

The central communication hub hosting:
- WebSocket server at `ws://localhost:4000/connect`
- HTTP endpoint at `POST /chat`

### @hacker-agent/agent

The AI brain powered by:
- LangChain with Claude
- ReadTool for safe data fetching
- PlanTool for proposing write operations

### @hacker-agent/frontend-sdk

The UI layer featuring:
- Split pane layout (Chat + Flow Visualizer)
- Function Registry with localStorage persistence
- Execution Engine with sandboxed function execution

### @hacker-agent/shared

Shared TypeScript types used across packages.

## Function Types

### Read Functions
Safe operations that execute immediately:
- `listClusters` - Get all clusters
- `getClusterDetails` - Get cluster info
- `getClusterLogs` - Fetch cluster logs

### Write Functions
Dangerous operations that require user approval:
- `restartCluster` - Restart a cluster
- `scaleCluster` - Change node count
- `deleteCluster` - Delete a cluster

## Message Protocol

### Server → SDK

```typescript
type ServerEvent =
  | { type: "EXECUTE_READ"; requestId: string; reads: ReadOperation[] }
  | { type: "PROPOSE_FLOW"; plan: FlowPlan }
  | { type: "CHAT_STREAM"; content: string; done: boolean };
```

### SDK → Server

```typescript
type ClientEvent =
  | { type: "SYNC_REGISTRY"; functions: FunctionDefinition[] }
  | { type: "READ_RESULT"; requestId: string; results: ReadResult[] }
  | { type: "FLOW_RESULT"; planId: string; results: FlowNode[] };
```

## License

MIT
