import * as hyw from "@hoyowave/jsapi";
import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  type ExecutorFunctionDefinition,
  type FunctionDefinition,
  type JSONSchemaParameters,
} from "@ocean-mcp/shared";

// ─── Wave Environment Detection ─────────────────────────────────────────────

/**
 * Check whether the current page is running inside the HoYowave (Wave) app.
 *
 * Detection is based on `navigator.userAgent` containing the string `"wave"`
 * (case-insensitive).
 */
export function isWaveEnv(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("wave")
  );
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

function makeShowToast(): ExecutorFunctionDefinition {
  return {
    id: "hywShowToast",
    name: "HYW Show Toast",
    cnName: "显示消息提示",
    description:
      "Display a toast notification inside the Wave app. Supports success, error, info, warning, and nonBlocking types.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.WRITE,
    autoApprove: true,
    executor: async (args) => {
      const result = await hyw.showToast({
        content: args.content,
        ...(args.type && { type: args.type }),
      });
      return result;
    },
    parameters: {
      type: "object",
      required: ["content"],
      properties: {
        content: {
          type: "string",
          description: "The toast message content to display.",
        },
        type: {
          type: "string",
          description: "Toast icon type.",
          enum: ["success", "error", "info", "warning", "nonBlocking"],
        },
      },
      additionalProperties: false,
    } satisfies JSONSchemaParameters,
  };
}

function makeGetSystemInfo(): ExecutorFunctionDefinition {
  return {
    id: "hywGetSystemInfo",
    name: "HYW Get System Info",
    cnName: "获取系统信息",
    description:
      "Get device system information from the Wave app, including language, device ID, and current theme (light/dark).",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.READ,
    executor: async () => {
      const result = await hyw.getSystemInfo();
      return {
        language: result.language,
        deviceId: result.deviceId,
        theme: result.theme,
      };
    },
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    } satisfies JSONSchemaParameters,
  };
}

function makeSetClipboardData(): ExecutorFunctionDefinition {
  return {
    id: "hywSetClipboardData",
    name: "HYW Set Clipboard",
    cnName: "设置剪贴板",
    description:
      "Copy text data to the system clipboard via the Wave app bridge.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.WRITE,
    autoApprove: true,
    executor: async (args) => {
      const result = await hyw.setClipboardData({ data: args.data });
      return result;
    },
    parameters: {
      type: "object",
      required: ["data"],
      properties: {
        data: {
          type: "string",
          description: "The text to copy to the clipboard.",
        },
      },
      additionalProperties: false,
    } satisfies JSONSchemaParameters,
  };
}

function makeGetClipboardData(): ExecutorFunctionDefinition {
  return {
    id: "hywGetClipboardData",
    name: "HYW Get Clipboard",
    cnName: "获取剪贴板",
    description:
      "Read the current text content from the system clipboard via the Wave app bridge.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.READ,
    executor: async () => {
      const result = await hyw.getClipboardData();
      return { data: result.data };
    },
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    } satisfies JSONSchemaParameters,
  };
}

function makeScanCode(): ExecutorFunctionDefinition {
  return {
    id: "hywScanCode",
    name: "HYW Scan QR Code",
    cnName: "扫描二维码",
    description:
      "Open the QR code scanner in the Wave app and return the scan result. Set needResult to false to let HoYowave handle the result directly.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.READ,
    executor: async (args) => {
      const result = await hyw.scanCode({
        scanType: ["qrCode"],
        needResult: args.needResult !== false,
      });
      return { resultStr: result.resultStr };
    },
    parameters: {
      type: "object",
      properties: {
        needResult: {
          type: "boolean",
          description:
            "If true (default), the scan result is returned directly. If false, HoYowave handles the result internally.",
          default: true,
        },
      },
      additionalProperties: false,
    } satisfies JSONSchemaParameters,
  };
}

function makeOpenWithWebview(): ExecutorFunctionDefinition {
  return {
    id: "hywOpenWithWebview",
    name: "HYW Open Webview",
    cnName: "在Webview中打开链接",
    description:
      "Open a URL in a new webview inside the Wave app (stays within the app).",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.WRITE,
    executor: async (args) => {
      const result = await hyw.openWithWebview({ url: args.url });
      return result;
    },
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "The URL to open in a new webview.",
        },
      },
      additionalProperties: false,
    } satisfies JSONSchemaParameters,
  };
}

function makeOpenWithBrowser(): ExecutorFunctionDefinition {
  return {
    id: "hywOpenWithBrowser",
    name: "HYW Open Browser",
    cnName: "在浏览器中打开链接",
    description:
      "Open a URL in the external system browser (leaves the Wave app).",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.WRITE,
    executor: async (args) => {
      const result = await hyw.openWithBrowser({ url: args.url });
      return result;
    },
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "The URL to open in the external browser.",
        },
      },
      additionalProperties: false,
    } satisfies JSONSchemaParameters,
  };
}

function makeCloseWindow(): ExecutorFunctionDefinition {
  return {
    id: "hywCloseWindow",
    name: "HYW Close Window",
    cnName: "关闭当前窗口",
    description: "Close the current webview window in the Wave app.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.WRITE,
    executor: async () => {
      const result = await hyw.closeWindow();
      return result;
    },
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    } satisfies JSONSchemaParameters,
  };
}

function makeSetNavigationBar(): ExecutorFunctionDefinition {
  return {
    id: "hywSetNavigationBar",
    name: "HYW Set Navigation Bar",
    cnName: "设置导航栏",
    description:
      "Customize the navigation bar in the Wave app. Set the title and configure left/right button items. Each item has an id (triggers onNavigationBarClick listener when clicked), optional text, and optional icon (base64).",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.WRITE,
    executor: async (args) => {
      const params: Record<string, any> = {};
      if (args.title) params.title = args.title;
      if (args.rightItems) {
        params.right = { items: args.rightItems };
      }
      if (args.leftItems) {
        params.left = { items: args.leftItems };
      }
      const result = await hyw.setNavigationBar(params as any);
      return result;
    },
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "Navigation bar title. If not set, defaults to the <title> tag.",
        },
        rightItems: {
          type: "array",
          description: "Button items on the right side of the navigation bar.",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description:
                  "Unique item ID. Triggers onNavigationBarClick listener when clicked.",
              },
              text: {
                type: "string",
                description: "Button display text. Empty string to hide text.",
              },
              imageBase64: {
                type: "string",
                description: "Light theme icon as base64 string.",
              },
              darkImageBase64: {
                type: "string",
                description: "Dark theme icon as base64 string.",
              },
            },
            required: ["id"],
          },
        },
        leftItems: {
          type: "array",
          description: "Button items on the left side of the navigation bar.",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description:
                  "Unique item ID. Triggers onNavigationBarClick listener when clicked.",
              },
              text: {
                type: "string",
                description: "Button display text. Empty string to hide text.",
              },
              imageBase64: {
                type: "string",
                description: "Light theme icon as base64 string.",
              },
              darkImageBase64: {
                type: "string",
                description: "Dark theme icon as base64 string.",
              },
            },
            required: ["id"],
          },
        },
      },
      additionalProperties: false,
    } satisfies JSONSchemaParameters,
  };
}

function makeEnterChat(): ExecutorFunctionDefinition {
  return {
    id: "hywEnterChat",
    name: "HYW Enter Chat",
    cnName: "打开会话",
    description:
      "Open a chat conversation in the Wave app. Can open a group chat by chatId, or a direct message by unionId or userId (domain account). Provide exactly one of the three identifiers.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.WRITE,
    executor: async (args) => {
      const params: Record<string, string> = {};
      if (args.chatId) params.chatId = args.chatId;
      if (args.unionId) params.unionId = args.unionId;
      if (args.userId) params.userId = args.userId;
      const result = await hyw.enterChat(params);
      return result;
    },
    parameters: {
      type: "object",
      properties: {
        chatId: {
          type: "string",
          description:
            "Open platform group chat ID. Use this to open a group conversation.",
        },
        unionId: {
          type: "string",
          description:
            "Open platform user ID. Use this to open a direct message with a user.",
        },
        userId: {
          type: "string",
          description:
            "Domain account (e.g. employee ID). Use this to open a direct message with a user by their domain account.",
        },
      },
      additionalProperties: false,
    } satisfies JSONSchemaParameters,
  };
}

function makeDownloadFile(): ExecutorFunctionDefinition {
  return {
    id: "hywDownloadFile",
    name: "HYW Download File",
    cnName: "下载文件",
    description:
      "Download a file to the local device via the Wave app. Requires file metadata (name, size, type) and a download URL.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.WRITE,
    executor: async (args) => {
      const result = await hyw.downloadFile({
        source: args.source,
        fileName: args.fileName,
        fileSize: args.fileSize,
        fileType: args.fileType,
        url: args.url,
        fileIdentifyKey: args.fileIdentifyKey,
      });
      return result;
    },
    parameters: {
      type: "object",
      required: [
        "source",
        "fileName",
        "fileSize",
        "fileType",
        "url",
        "fileIdentifyKey",
      ],
      properties: {
        source: {
          type: "string",
          description:
            'The business source identifier, e.g. "km" for knowledge management.',
        },
        fileName: {
          type: "string",
          description: 'File name with extension, e.g. "report.pdf".',
        },
        fileSize: {
          type: "number",
          description: "File size in bytes.",
          minimum: 0,
        },
        fileType: {
          type: "string",
          description: 'File type/extension, e.g. "pdf", "xlsx", "docx".',
        },
        url: {
          type: "string",
          description: "The file download URL.",
        },
        fileIdentifyKey: {
          type: "string",
          description:
            "A unique and immutable key to identify the file and prevent duplicate downloads.",
        },
      },
      additionalProperties: false,
    } satisfies JSONSchemaParameters,
  };
}

// ─── Export all HoYowave API functions ────────────────────────────────────────

export const hoyowaveApiFunctions: FunctionDefinition[] = [
  makeShowToast(),
  makeGetSystemInfo(),
  makeSetClipboardData(),
  makeGetClipboardData(),
  makeScanCode(),
  makeOpenWithWebview(),
  makeOpenWithBrowser(),
  makeCloseWindow(),
  makeSetNavigationBar(),
  makeEnterChat(),
  makeDownloadFile(),
];
