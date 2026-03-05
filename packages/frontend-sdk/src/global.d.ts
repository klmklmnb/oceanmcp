/**
 * Global type declarations for the UMD build of @ocean-mcp/frontend-sdk.
 *
 * When the SDK is loaded via a `<script>` tag, `OceanMCPSDK` is attached to
 * `window`. This file augments the global scope so TypeScript projects that
 * consume the UMD bundle get full type safety.
 *
 * Usage (pick one):
 *   1. Add to tsconfig.json `"types"` or `"compilerOptions.types"`:
 *      `"types": ["./path-to/sdk.umd"]`
 *   2. Triple-slash reference in any `.ts` / `.d.ts` file:
 *      `/// <reference path="./path-to/sdk.umd.d.ts" />`
 */

import type { OceanMCPSDKType } from "./types";

// Re-export all public types so UMD consumers can reference them
// via `OceanMCPSDK.MountOptions` etc. in JSDoc or type annotations.
export type {
  OceanMCPSDKType,
  MountTarget,
  MountOptions,
  ModelConfig,
  FunctionDefinition,
  CodeFunctionDefinition,
  ExecutorFunctionDefinition,
  BaseFunctionDefinition,
  ParameterDefinition,
  ColumnConfig,
  FunctionSchema,
  FileAttachment,
  FlowPlan,
  FlowStep,
  FunctionType,
  OperationType,
  ParameterType,
  SkillDefinition,
  UploadHandler,
  UploadResult,
  SupportedLocale,
  SuggestionItem,
  Theme,
} from "./types";

declare global {
  /** The OceanMCP frontend SDK, available after loading `sdk.umd.js`. */
  const OceanMCPSDK: OceanMCPSDKType;

  interface Window {
    /** The OceanMCP frontend SDK, available after loading `sdk.umd.js`. */
    OceanMCPSDK: OceanMCPSDKType;
  }
}
