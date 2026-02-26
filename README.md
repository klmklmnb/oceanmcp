# 基于 WebMCP 的 OceanMCP 服务

## 本地开发

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