# OceanMCP

> **Browser-in-the-Loop** AI 智能体 SDK

OceanMCP 是一个内置 AI 聊天助手的 SDK，提供了基于浏览器执行逻辑的工具调用机制（Browser-in-the-Loop），以及高度可配置的界面 UI（支持 `light`、`dark` 以及系统级 `auto` 主题切换）。

详细的 SDK 接入指南，请参阅 [SDK 接入文档](./INTEGRATE_ZH.md) 或 [Integration Guide (English)](./INTEGRATE.md)。

## 本地开发

### 安装依赖

```bash
bun i
```

### 启动后端服务

```bash
cd packages/api-server
bun run dev
```

### 启动前端

```bash
cd packages/frontend-sdk
bun run dev
```

### 运行测试

```bash
cd packages/frontend-sdk
bun run test
```

## 项目结构

```
oceanmcp/
  packages/
    api-server/     # 后端 API 服务（LLM 代理、WebSocket、技能发现）
    frontend-sdk/   # 前端 SDK（聊天组件、工具注册、技能系统）
    shared/         # 共享类型与常量
```

## 许可证

[MIT](./LICENSE)
