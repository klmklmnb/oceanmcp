---
name: mixed-tools-demo
description: Demonstrates both Vercel AI SDK tools and CodeFunctionDefinition tools coexisting in a single skill. Use to test mixed tool type support.
---

# Mixed Tools Demo

This skill contains tools in two formats:

1. **Vercel AI SDK Tool** (`echo`) — uses `tool()` from the `ai` package with a Zod schema and a server-side `execute` function.
2. **CodeFunctionDefinition** (`encodeBase64`, `decodeBase64`, `generateUUID`) — uses the ocean-mcp format with a `code` string executed via `new Function()`.

Both tool types are exported from the same `tools.ts` default export. The system auto-detects and wraps CodeFunctionDefinition entries.

## Testing

- Ask: "Echo back the text 'hello world'" (tests AI SDK tool)
- Ask: "Encode 'hello world' in base64" (tests code tool)
- Ask: "Decode 'aGVsbG8gd29ybGQ=' from base64" (tests code tool)
- Ask: "Generate a UUID" (tests code tool)
