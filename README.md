# 基于 WebMCP 的 OceanMCP 服务

OceanMCP 是一个内置 AI 聊天助手的 SDK，提供了基于浏览器执行逻辑的工具调用机制（Browser-in-the-Loop），以及高度可配置的界面UI（支持 `light`, `dark`, 以及系统级 `auto` 主题切换）。

详细的 SDK 接入指南，请参阅 [SDK 接入文档](./INTEGRATE_ZH.md) 或 [Integration Guide](./INTEGRATE.md)。

## 本地开发

0. 安装依赖

```bash
bun i
```

1. 启动后端服务

```bash
cd packages/api-server
bun run dev
```

2. 启动前端

```bash
cd packages/frontend-sdk
bun run dev
```

3. 打开浏览器 `https://oceanmcp-test.mihoyo.com/`，记得先 whistle 添加代理：

```bash
https://oceanmcp-test.mihoyo.com/ http://127.0.0.1:3000/
wss://oceanmcp-test.mihoyo.com/ ws://127.0.0.1:3000/
```
