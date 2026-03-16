# HoYowave API Skill

Interact with the HoYowave (Wave) app native capabilities through its JS API bridge. This skill provides tools for UI interactions, navigation, chat, and device info within the Wave environment.

## Environment Requirement

This skill **only works inside the HoYowave (Wave) app**. The Wave environment is detected by checking whether `navigator.userAgent` contains the string `"wave"` (case-insensitive). If the current page is not running inside Wave, all API calls will fail.

## API Calling Convention

All HoYowave APIs are **asynchronous** (Promise-based). The response object always includes:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `errMsg` | string | yes | `"${apiName}:ok"` on success, `"${apiName}:fail"` on failure |
| `errCode` | number | no | Error code on failure. Success does not return `errCode` (client code 0 is omitted). |
| *(other)* | any | no | Additional response data on success |

Input parameters are always `Object` type with **camelCase** property naming.

## Available Tools

### hywShowToast (write, auto-approve)

Display a toast notification in the Wave app.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `content` | string | yes | The message text to display |
| `type` | string | no | Icon type: `"success"`, `"error"`, `"info"`, `"warning"`, or `"nonBlocking"` |

### hywGetSystemInfo (read)

Get device/system information.

**Parameters:** None.

**Returns:** `{ language, deviceId, theme }` where `theme` is `"light"` or `"dark"`.

### hywOpenWithWebview (write)

Open a URL in a new webview within the Wave app.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `url` | string | yes | The URL to open |

### hywOpenWithBrowser (write)

Open a URL in the external system browser.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `url` | string | yes | The URL to open |

### hywSetNavigationBar (write)

Customize the Wave app navigation bar.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `title` | string | no | Navigation bar title (defaults to `<title>` tag) |
| `rightItems` | array | no | Right-side button items: `[{ id, text?, imageBase64?, darkImageBase64? }]` |
| `leftItems` | array | no | Left-side button items: `[{ id, text?, imageBase64?, darkImageBase64? }]` |

Each item's `id` is used to identify button clicks via the `onNavigationBarClick` event listener.

### hywEnterChat (write)

Open a chat conversation in the Wave app. Can open a group chat or a direct message.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `chatId` | string | no | Open platform group chat ID. Use to open a group conversation. |
| `unionId` | string | no | Open platform user ID. Use to open a direct message. |
| `userId` | string | no | Domain account (e.g. employee ID). Use to open a direct message by domain account. |

Provide exactly one of `chatId`, `unionId`, or `userId`.

## Event Listeners (Reference Only)

The following event listeners are available via `hyw.on*` methods but are **not exposed as tools**. They are useful for the host application to listen to Wave app events:

- **`onNavigationBarClick(listener)`** — Fires when a custom navigation bar button is clicked. Receives `{ id }` matching the button item's `id` from `setNavigationBar`.
- **`onContextMenuClick(listener)`** — Fires when a custom context menu item is clicked. Receives `{ index }` — the item index.
- **`onThemeChange(listener)`** — Fires when the system theme changes. Receives `{ theme: 'light' | 'dark' }`.
- **`onWebviewStateChange(listener)`** — Fires when the webview tab is activated/deactivated. Receives `{ activated: boolean }`.
- **`onAppStateChange(listener)`** — Fires when the Wave app is activated/deactivated. Receives `{ activated: boolean }`.
- **`onNetworkStatusChange(listener)`** — Fires when network status changes. Receives `{ isConnected, networkType }`.
- **`onHistoryBack(listener)`** — Intercept the back button. Return `{ status: false }` to prevent navigation.

## Error Handling

When a tool call fails, the HoYowave bridge returns an object with:
- `errMsg`: `"${apiName}:fail"` (or `"${apiName}:fail ${reason}"`)
- `errCode`: A numeric error code (when applicable)

The tool executor will propagate errors. If the API fails, inspect the error message for details.

## Common Patterns

### Check environment before using tools

Always verify the user is in the Wave app before calling any HoYowave tool. If not in Wave, inform the user that these tools require the HoYowave app.

### Navigation bar with click handling

1. Call `hywSetNavigationBar` to add custom buttons
2. The host application should register `onNavigationBarClick` to handle button clicks

### Open a chat conversation

Call `hywEnterChat` with `chatId` to open a group chat, or with `unionId`/`userId` to open a DM

## Usage

Use this skill when the user wants to:

- Show toast notifications or messages in the Wave app
- Get device/system information (language, device ID, theme)
- Open links in a webview or external browser
- Customize the navigation bar
- Open a chat conversation (group or direct message)
