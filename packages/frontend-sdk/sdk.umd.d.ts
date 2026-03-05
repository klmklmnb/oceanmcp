// Bridge file for Node10 moduleResolution compatibility.
//
// With "moduleResolution": "node", TypeScript ignores the "exports" field
// in package.json and resolves:
//   /// <reference types="@ocean-mcp/frontend-sdk/sdk.umd" />
// by looking for a root-level `sdk.umd.d.ts`. This file bridges that gap
// by re-referencing the actual declaration file in dist/.
/// <reference path="./dist/sdk.umd.d.ts" />
