import type { FunctionDefinition } from "oceanmcp-shared";
import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  PARAMETER_TYPE,
} from "oceanmcp-shared";
import type { SkillDefinition } from "../registry/skill-registry";

type SDKRegistrar = {
  registerTool: (definition: Partial<FunctionDefinition> & { id: string }) => void;
  unregisterTool: (id: string) => void;
  registerSkill: (definition: SkillDefinition) => void;
  unregisterSkill: (name: string) => void;
};

function toNumberArray(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const nums = input
    .map((item) => Number(item))
    .filter((value) => Number.isFinite(value));
  return nums.slice(0, 20);
}

function createSparklineDescriptor(title: string, values: number[]) {
  return {
    type: "dom" as const,
    render: (container: HTMLElement) => {
      container.innerHTML = "";

      const frame = document.createElement("div");
      frame.style.border = "1px solid #dbeafe";
      frame.style.background = "#eff6ff";
      frame.style.borderRadius = "10px";
      frame.style.padding = "10px";
      frame.style.display = "flex";
      frame.style.flexDirection = "column";
      frame.style.gap = "8px";

      const heading = document.createElement("div");
      heading.textContent = title;
      heading.style.fontSize = "12px";
      heading.style.fontWeight = "700";
      heading.style.color = "#1d4ed8";
      frame.appendChild(heading);

      const line = document.createElement("div");
      line.style.display = "grid";
      line.style.gridTemplateColumns = "repeat(auto-fit, minmax(12px, 1fr))";
      line.style.alignItems = "end";
      line.style.gap = "4px";
      line.style.height = "56px";

      const max = values.length > 0 ? Math.max(...values) : 1;
      for (const value of values) {
        const bar = document.createElement("div");
        bar.style.height = `${Math.max(4, Math.round((value / max) * 56))}px`;
        bar.style.borderRadius = "4px";
        bar.style.background = "linear-gradient(180deg, #60a5fa, #2563eb)";
        bar.title = String(value);
        line.appendChild(bar);
      }

      frame.appendChild(line);
      container.appendChild(frame);
    },
  };
}

const standaloneToolFixtures: FunctionDefinition[] = [
  {
    id: "test_read_echo",
    name: "Test Read Echo",
    cnName: "测试读取回声",
    description: "Return the provided text with metadata.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.READ,
    parameters: [
      {
        name: "text",
        type: PARAMETER_TYPE.STRING,
        description: "Text to echo back.",
        required: true,
      },
      {
        name: "tags",
        type: PARAMETER_TYPE.STRING_ARRAY,
        description: "Optional tags array.",
        required: false,
      },
    ],
    executor: async (args) => {
      return {
        ok: true,
        echoedText: args.text,
        tags: Array.isArray(args.tags) ? args.tags : [],
        timestamp: new Date().toISOString(),
      };
    },
  },
  {
    id: "test_read_fail",
    name: "Test Read Fail",
    cnName: "测试读取失败",
    description: "Always throws an error for error-state testing.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.READ,
    parameters: [
      {
        name: "reason",
        type: PARAMETER_TYPE.STRING,
        description: "Failure reason for debugging.",
        required: false,
      },
    ],
    executor: async (args) => {
      const reason = typeof args.reason === "string" && args.reason.trim()
        ? args.reason.trim()
        : "mock failure";
      throw new Error(`test_read_fail: ${reason}`);
    },
  },
  {
    id: "test_read_dom_render",
    name: "Test Read DOM Render",
    cnName: "测试读取可视化",
    description: "Returns result and renders a tiny visual card.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.READ,
    parameters: [
      {
        name: "title",
        type: PARAMETER_TYPE.STRING,
        description: "Card title.",
        required: false,
      },
      {
        name: "values",
        type: PARAMETER_TYPE.NUMBER_ARRAY,
        description: "Numeric values for mini chart.",
        required: false,
      },
    ],
    showRender: (step) => {
      const result = (step.result ?? {}) as Record<string, any>;
      const args = step.arguments ?? {};
      const title = typeof result.title === "string"
        ? result.title
        : typeof args.title === "string"
          ? args.title
          : "Visual Result";
      const values = toNumberArray(result.values ?? args.values);
      return createSparklineDescriptor(title, values.length > 0 ? values : [3, 6, 2, 8]);
    },
    executor: async (args) => {
      const title = typeof args.title === "string" && args.title.trim()
        ? args.title.trim()
        : "Visual Result";
      const values = toNumberArray(args.values);
      return {
        ok: true,
        title,
        values: values.length > 0 ? values : [5, 8, 4, 10],
      };
    },
  },
  {
    id: "test_write_requires_approval",
    name: "Test Write Requires Approval",
    cnName: "测试写入需审批",
    description: "Write tool for approval-flow testing.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.WRITE,
    parameters: [
      {
        name: "target",
        type: PARAMETER_TYPE.STRING,
        description: "Target resource name.",
        required: true,
      },
      {
        name: "enabled",
        type: PARAMETER_TYPE.BOOLEAN,
        description: "Target toggle state.",
        required: true,
      },
    ],
    executor: async (args) => {
      return {
        applied: true,
        target: args.target,
        enabled: Boolean(args.enabled),
        mode: "approval-required",
      };
    },
  },
  {
    id: "test_write_auto_approved",
    name: "Test Write Auto Approved",
    cnName: "测试写入自动通过",
    description: "Write tool that bypasses approval via autoApprove.",
    type: FUNCTION_TYPE.EXECUTOR,
    operationType: OPERATION_TYPE.WRITE,
    autoApprove: true,
    parameters: [
      {
        name: "operation",
        type: PARAMETER_TYPE.STRING,
        description: "Operation name.",
        required: true,
      },
      {
        name: "payload",
        type: PARAMETER_TYPE.OBJECT,
        description: "Operation payload.",
        required: false,
      },
    ],
    executor: async (args) => {
      return {
        applied: true,
        operation: args.operation,
        payload: args.payload ?? {},
        mode: "auto-approved",
      };
    },
  },
  {
    id: "test_code_transform",
    name: "Test Code Transform",
    cnName: "测试代码工具",
    description: "Code-type tool that transforms text.",
    type: FUNCTION_TYPE.CODE,
    operationType: OPERATION_TYPE.READ,
    parameters: [
      {
        name: "value",
        type: PARAMETER_TYPE.STRING,
        description: "Input value.",
        required: true,
      },
    ],
    code: `
const value = typeof args.value === "string" ? args.value : "";
return {
  original: value,
  uppercase: value.toUpperCase(),
  length: value.length
};
`,
  },
];

const skillFixtures: SkillDefinition[] = [
  {
    name: "test-skill-ops",
    cnName: "测试技能-运维",
    description: "Mock skill with read and write tools for UI testing.",
    instructions: `
# Test Skill Ops

Use this skill to test skill loading and mixed tool states.
- Prefer test_skill_lookup_orders for read queries.
- Use test_skill_write_flag for write operations that require approval.
`,
    tools: [
      {
        id: "test_skill_lookup_orders",
        name: "Test Skill Lookup Orders",
        cnName: "测试技能查询订单",
        description: "Return mocked orders for a customer.",
        type: FUNCTION_TYPE.EXECUTOR,
        operationType: OPERATION_TYPE.READ,
        parameters: [
          {
            name: "customer",
            type: PARAMETER_TYPE.STRING,
            description: "Customer name.",
            required: true,
          },
        ],
        executor: async (args) => {
          const customer = typeof args.customer === "string" ? args.customer : "guest";
          return {
            customer,
            orders: [
              { id: "ORD-1001", amount: 89.5, status: "paid" },
              { id: "ORD-1002", amount: 129, status: "shipped" },
            ],
          };
        },
      },
      {
        id: "test_skill_write_flag",
        name: "Test Skill Write Flag",
        cnName: "测试技能写入标记",
        description: "Write tool in skill for approval tests.",
        type: FUNCTION_TYPE.EXECUTOR,
        operationType: OPERATION_TYPE.WRITE,
        parameters: [
          {
            name: "flag",
            type: PARAMETER_TYPE.STRING,
            description: "Feature flag key.",
            required: true,
          },
          {
            name: "value",
            type: PARAMETER_TYPE.BOOLEAN,
            description: "Feature flag value.",
            required: true,
          },
        ],
        executor: async (args) => ({
          updated: true,
          flag: args.flag,
          value: Boolean(args.value),
          source: "test-skill-ops",
        }),
      },
    ],
  },
  {
    name: "test-skill-visual",
    cnName: "测试技能-可视化",
    description: "Mock skill with custom render output.",
    instructions: `
# Test Skill Visual

Use test_skill_visual_card when you need a compact visual result.
`,
    tools: [
      {
        id: "test_skill_visual_card",
        name: "Test Skill Visual Card",
        cnName: "测试技能可视卡片",
        description: "Read tool with custom render card.",
        type: FUNCTION_TYPE.EXECUTOR,
        operationType: OPERATION_TYPE.READ,
        parameters: [
          {
            name: "title",
            type: PARAMETER_TYPE.STRING,
            description: "Card title.",
            required: false,
          },
          {
            name: "values",
            type: PARAMETER_TYPE.NUMBER_ARRAY,
            description: "Chart values.",
            required: false,
          },
        ],
        showRender: (step) => {
          const result = (step.result ?? {}) as Record<string, any>;
          const args = step.arguments ?? {};
          const title = typeof result.title === "string"
            ? result.title
            : typeof args.title === "string"
              ? args.title
              : "Skill Visual";
          const values = toNumberArray(result.values ?? args.values);
          return createSparklineDescriptor(title, values.length > 0 ? values : [2, 5, 7, 4]);
        },
        executor: async (args) => {
          const title = typeof args.title === "string" && args.title.trim()
            ? args.title.trim()
            : "Skill Visual";
          const values = toNumberArray(args.values);
          return {
            ok: true,
            title,
            values: values.length > 0 ? values : [1, 4, 9, 6],
          };
        },
      },
    ],
  },
  {
    name: "test-skill-askuser-form",
    cnName: "测试技能-askUser表单",
    description:
      "Mock skill for testing the askUser interactive form with all supported field types: " +
      "text input, select dropdown, toggle buttons, date picker, time picker, textarea, " +
      "number input, boolean buttons, and checkbox group (multiselect).",
    instructions: `
# Test Skill — askUser Form

This skill is for **testing** the \`askUser\` tool's interactive form UI.
When the user asks to test askUser forms, call \`test_askuser_get_schemas\`
with the desired \`formType\`. It returns the exact \`askUser\` schema you
should pass to \`askUser\`. Then call \`askUser\` with that schema verbatim.

## Workflow

1. Call \`test_askuser_get_schemas\` with the requested \`formType\`.
2. The result contains \`message\` and \`schema\` fields.
3. Call \`askUser\` with \`{ message: result.message, schema: result.schema }\`.
4. Report the user's submitted values back.

## Available form types

| formType | Description |
|---|---|
| all | Comprehensive form with all 9 field types |
| multiselect | Checkbox group (array + items.enum) only |
| date-time | Date picker + time picker fields |
| text-fields | Text input + textarea fields |
| enum-select | Enum toggle buttons (≤2) + dropdown (>3) with enumLabels |
`,
    tools: [
      {
        id: "test_askuser_get_schemas",
        name: "Test AskUser Get Schemas",
        cnName: "测试askUser获取表单Schema",
        description:
          "Returns the askUser schema for a given form type. " +
          "After receiving the result, call askUser with the returned message and schema.",
        type: FUNCTION_TYPE.EXECUTOR,
        operationType: OPERATION_TYPE.READ,
        autoApprove: true,
        parameters: [
          {
            name: "formType",
            type: PARAMETER_TYPE.STRING,
            description:
              'Form variant to generate. One of: "all", "multiselect", "date-time", "text-fields", "enum-select".',
            required: true,
            enumMap: {
              all: "All field types",
              multiselect: "Checkbox group only",
              "date-time": "Date & time pickers",
              "text-fields": "Text & textarea",
              "enum-select": "Enum buttons & dropdown",
            },
          },
        ],
        executor: async (args) => {
          const formType = typeof args.formType === "string" ? args.formType : "all";

          const schemas: Record<string, { message: string; schema: any }> = {
            all: {
              message: "askUser 全字段类型测试表单",
              schema: {
                type: "object",
                properties: {
                  username: {
                    type: "string",
                    title: "用户名",
                    description: "请输入用户名",
                  },
                  bio: {
                    type: "string",
                    title: "个人简介",
                    description: "请输入个人简介（多行文本）",
                    format: "textarea",
                  },
                  gender: {
                    type: "string",
                    title: "性别",
                    enum: ["male", "female"],
                    enumLabels: { male: "男", female: "女" },
                  },
                  department: {
                    type: "string",
                    title: "部门",
                    enum: ["engineering", "design", "product", "marketing", "hr"],
                    enumLabels: {
                      engineering: "工程部",
                      design: "设计部",
                      product: "产品部",
                      marketing: "市场部",
                      hr: "人力资源",
                    },
                  },
                  birthday: {
                    type: "string",
                    title: "生日",
                    format: "date",
                  },
                  preferredTime: {
                    type: "string",
                    title: "偏好会议时间",
                    format: "time",
                  },
                  age: {
                    type: "number",
                    title: "年龄",
                    description: "请输入年龄",
                  },
                  subscribe: {
                    type: "boolean",
                    title: "订阅通知",
                    enumLabels: { true: "是，订阅", false: "不，谢谢" },
                  },
                  skills: {
                    type: "array",
                    title: "技能标签（多选）",
                    items: {
                      enum: ["javascript", "typescript", "python", "rust", "go", "java"],
                    },
                    enumLabels: {
                      javascript: "JavaScript",
                      typescript: "TypeScript",
                      python: "Python",
                      rust: "Rust",
                      go: "Go",
                      java: "Java",
                    },
                  },
                },
                required: ["username", "department", "skills"],
              },
            },
            multiselect: {
              message: "多选复选框测试 — 请选择你感兴趣的领域",
              schema: {
                type: "object",
                properties: {
                  interests: {
                    type: "array",
                    title: "兴趣领域（多选）",
                    items: {
                      enum: [
                        "frontend",
                        "backend",
                        "devops",
                        "ai-ml",
                        "mobile",
                        "security",
                        "data",
                        "cloud",
                      ],
                    },
                    enumLabels: {
                      frontend: "前端开发",
                      backend: "后端开发",
                      devops: "DevOps",
                      "ai-ml": "AI / 机器学习",
                      mobile: "移动开发",
                      security: "安全",
                      data: "数据工程",
                      cloud: "云计算",
                    },
                  },
                  tools: {
                    type: "array",
                    title: "常用工具（多选）",
                    items: {
                      enum: ["vscode", "vim", "jetbrains", "cursor"],
                    },
                    enumLabels: {
                      vscode: "VS Code",
                      vim: "Vim / Neovim",
                      jetbrains: "JetBrains IDE",
                      cursor: "Cursor",
                    },
                  },
                },
                required: ["interests"],
              },
            },
            "date-time": {
              message: "日期 & 时间选择器测试",
              schema: {
                type: "object",
                properties: {
                  startDate: {
                    type: "string",
                    title: "开始日期",
                    format: "date",
                  },
                  endDate: {
                    type: "string",
                    title: "结束日期",
                    format: "date",
                  },
                  meetingTime: {
                    type: "string",
                    title: "会议时间",
                    format: "time",
                  },
                  reminderTime: {
                    type: "string",
                    title: "提醒时间",
                    format: "time",
                  },
                },
                required: ["startDate", "meetingTime"],
              },
            },
            "text-fields": {
              message: "文本输入测试",
              schema: {
                type: "object",
                properties: {
                  title: {
                    type: "string",
                    title: "标题",
                    description: "请输入标题",
                  },
                  email: {
                    type: "string",
                    title: "邮箱",
                    description: "user@example.com",
                  },
                  content: {
                    type: "string",
                    title: "详细描述",
                    description: "请输入详细描述...",
                    format: "textarea",
                  },
                  count: {
                    type: "number",
                    title: "数量",
                    description: "请输入数量",
                  },
                },
                required: ["title", "content"],
              },
            },
            "enum-select": {
              message: "枚举选择测试 — 按钮 & 下拉框 & enumLabels",
              schema: {
                type: "object",
                properties: {
                  confirm: {
                    type: "string",
                    title: "是否确认（≤2 = 按钮）",
                    enum: ["yes", "no"],
                    enumLabels: { yes: "确认", no: "取消" },
                  },
                  priority: {
                    type: "string",
                    title: "优先级（≤2 = 按钮）",
                    enum: ["high", "low"],
                    enumLabels: { high: "高优先级", low: "低优先级" },
                  },
                  environment: {
                    type: "string",
                    title: "部署环境（>3 = 下拉框）",
                    enum: ["dev", "staging", "pre", "prod"],
                    enumLabels: {
                      dev: "Development",
                      staging: "Staging",
                      pre: "Pre-production",
                      prod: "Production",
                    },
                  },
                  region: {
                    type: "string",
                    title: "服务区域（>3 = 下拉框 + enumLabels）",
                    enum: ["cn-east", "cn-north", "cn-south", "ap-southeast", "us-west"],
                    enumLabels: {
                      "cn-east": "华东",
                      "cn-north": "华北",
                      "cn-south": "华南",
                      "ap-southeast": "东南亚",
                      "us-west": "美西",
                    },
                  },
                  active: {
                    type: "boolean",
                    title: "是否激活",
                    enumLabels: { true: "激活", false: "停用" },
                  },
                },
                required: ["confirm", "environment"],
              },
            },
          };

          const selected = schemas[formType] ?? schemas.all;
          return {
            formType,
            ...selected,
            _hint: "Call askUser with the message and schema above.",
          };
        },
      },
    ],
  },
  {
    name: "test-skill-subagent",
    cnName: "测试技能-子智能体",
    description:
      "Mock skill with read-only tools designed for subagent delegation testing. " +
      "Provides server metrics, log search, and user profile lookup — ideal for " +
      "verifying parallel data-gathering via the subagent tool.",
    instructions: `
# Test Skill — Subagent Data Gathering

This skill provides read-only data sources for testing the **subagent** delegation feature.
The main agent should delegate research tasks to subagents using the \`subagent\` tool,
and subagents can call these tools to gather information.

## Available Tools

| Tool | Description |
|---|---|
| test_subagent_server_metrics | Returns mock CPU, memory, and request metrics for a given server |
| test_subagent_search_logs | Searches mock application logs by keyword and severity |
| test_subagent_user_profile | Looks up a mock user profile by username |
| test_subagent_flaky_service | Simulates a flaky service that fails on certain hosts |
| test_subagent_slow_query | Simulates a slow database query (configurable delay) |

## Example Delegation Patterns

### Single subagent
Delegate one research task:
> "Use a subagent to look up server metrics for web-01 and summarize the health status."

### Parallel subagents
Delegate multiple tasks concurrently:
> "Use subagents in parallel to: (1) get server metrics for web-01, (2) search for ERROR logs from the payment service, (3) look up user profile for alice."
`,
    tools: [
      {
        id: "test_subagent_server_metrics",
        name: "Test Subagent Server Metrics",
        cnName: "测试子智能体-服务器指标",
        description:
          "Returns mock server metrics (CPU, memory, request rate, error rate) for a given hostname.",
        type: FUNCTION_TYPE.EXECUTOR,
        operationType: OPERATION_TYPE.READ,
        parameters: [
          {
            name: "hostname",
            type: PARAMETER_TYPE.STRING,
            description:
              'Server hostname to query, e.g. "web-01", "api-02", "db-primary".',
            required: true,
          },
        ],
        executor: async (args) => {
          const hostname =
            typeof args.hostname === "string" && args.hostname.trim()
              ? args.hostname.trim()
              : "unknown-host";
          // Deterministic-ish mock data based on hostname hash
          const hash = hostname
            .split("")
            .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
          return {
            hostname,
            timestamp: new Date().toISOString(),
            cpu: {
              usagePercent: ((hash * 7) % 80) + 10, // 10-90%
              cores: ((hash % 4) + 1) * 4,
            },
            memory: {
              usedMB: ((hash * 13) % 8000) + 1024,
              totalMB: 16384,
              usagePercent: +(
                (((hash * 13) % 8000) + 1024) /
                163.84
              ).toFixed(1),
            },
            requests: {
              ratePerSecond: ((hash * 3) % 500) + 50,
              errorRate: +((hash % 50) / 10).toFixed(2),
              p99LatencyMs: ((hash * 11) % 300) + 20,
            },
            status:
              (hash * 3) % 500 + 50 > 400 ? "degraded" : "healthy",
          };
        },
      },
      {
        id: "test_subagent_search_logs",
        name: "Test Subagent Search Logs",
        cnName: "测试子智能体-搜索日志",
        description:
          "Searches mock application logs by keyword and optional severity filter. " +
          "Returns up to 10 matching log entries.",
        type: FUNCTION_TYPE.EXECUTOR,
        operationType: OPERATION_TYPE.READ,
        parameters: [
          {
            name: "keyword",
            type: PARAMETER_TYPE.STRING,
            description: "Search keyword to match in log messages.",
            required: true,
          },
          {
            name: "severity",
            type: PARAMETER_TYPE.STRING,
            description:
              'Log severity filter. One of: "DEBUG", "INFO", "WARN", "ERROR". If omitted, all severities are returned.',
            required: false,
            enumMap: {
              DEBUG: "Debug",
              INFO: "Info",
              WARN: "Warning",
              ERROR: "Error",
            },
          },
          {
            name: "service",
            type: PARAMETER_TYPE.STRING,
            description:
              'Service name filter, e.g. "payment", "auth", "gateway".',
            required: false,
          },
        ],
        executor: async (args) => {
          const keyword =
            typeof args.keyword === "string" ? args.keyword.trim() : "";
          const severity =
            typeof args.severity === "string"
              ? args.severity.toUpperCase()
              : null;
          const service =
            typeof args.service === "string" ? args.service.trim() : null;

          const mockLogs = [
            {
              ts: "2026-03-16T10:01:12Z",
              severity: "ERROR",
              service: "payment",
              message: "Payment gateway timeout after 30s for order ORD-5521",
            },
            {
              ts: "2026-03-16T10:01:14Z",
              severity: "WARN",
              service: "payment",
              message:
                "Retry attempt 2/3 for payment processing on ORD-5521",
            },
            {
              ts: "2026-03-16T10:02:00Z",
              severity: "INFO",
              service: "auth",
              message: 'User "alice" logged in from 10.0.1.42',
            },
            {
              ts: "2026-03-16T10:03:22Z",
              severity: "ERROR",
              service: "gateway",
              message:
                "Upstream connection refused: api-02:8080 (service: inventory)",
            },
            {
              ts: "2026-03-16T10:04:05Z",
              severity: "DEBUG",
              service: "auth",
              message: "Token refresh for session sess_abc123",
            },
            {
              ts: "2026-03-16T10:05:30Z",
              severity: "INFO",
              service: "gateway",
              message: "Route /api/v2/orders registered successfully",
            },
            {
              ts: "2026-03-16T10:06:18Z",
              severity: "WARN",
              service: "inventory",
              message:
                "Low stock alert: SKU-9042 has 3 units remaining",
            },
            {
              ts: "2026-03-16T10:07:00Z",
              severity: "ERROR",
              service: "payment",
              message:
                "Duplicate charge detected for customer cust_bob, amount $129.00",
            },
            {
              ts: "2026-03-16T10:08:45Z",
              severity: "INFO",
              service: "payment",
              message: "Refund processed for ORD-5488, amount $89.50",
            },
            {
              ts: "2026-03-16T10:09:11Z",
              severity: "DEBUG",
              service: "gateway",
              message: "Health check passed for all upstream targets",
            },
          ];

          const filtered = mockLogs.filter((log) => {
            if (
              keyword &&
              !log.message.toLowerCase().includes(keyword.toLowerCase())
            )
              return false;
            if (severity && log.severity !== severity) return false;
            if (service && log.service !== service) return false;
            return true;
          });

          return {
            query: { keyword, severity, service },
            totalMatches: filtered.length,
            logs: filtered.slice(0, 10),
          };
        },
      },
      {
        id: "test_subagent_user_profile",
        name: "Test Subagent User Profile",
        cnName: "测试子智能体-用户资料",
        description:
          "Looks up a mock user profile by username. Returns profile details including role, department, and activity.",
        type: FUNCTION_TYPE.EXECUTOR,
        operationType: OPERATION_TYPE.READ,
        parameters: [
          {
            name: "username",
            type: PARAMETER_TYPE.STRING,
            description: "Username to look up.",
            required: true,
          },
        ],
        executor: async (args) => {
          const username =
            typeof args.username === "string" && args.username.trim()
              ? args.username.trim().toLowerCase()
              : "unknown";

          const profiles: Record<
            string,
            {
              displayName: string;
              email: string;
              role: string;
              department: string;
              lastActive: string;
              projectCount: number;
            }
          > = {
            alice: {
              displayName: "Alice Chen",
              email: "alice@example.com",
              role: "Senior Engineer",
              department: "Platform Engineering",
              lastActive: "2026-03-16T09:45:00Z",
              projectCount: 12,
            },
            bob: {
              displayName: "Bob Wang",
              email: "bob@example.com",
              role: "Product Manager",
              department: "Product",
              lastActive: "2026-03-15T18:30:00Z",
              projectCount: 5,
            },
            charlie: {
              displayName: "Charlie Li",
              email: "charlie@example.com",
              role: "DevOps Lead",
              department: "Infrastructure",
              lastActive: "2026-03-16T10:00:00Z",
              projectCount: 8,
            },
          };

          const profile = profiles[username];
          if (!profile) {
            return {
              found: false,
              username,
              message: `No user found with username "${username}". Known users: ${Object.keys(profiles).join(", ")}`,
            };
          }

          return {
            found: true,
            username,
            ...profile,
          };
        },
      },
      {
        id: "test_subagent_flaky_service",
        name: "Test Subagent Flaky Service",
        cnName: "测试子智能体-不稳定服务",
        description:
          "Simulates a flaky microservice health check. Certain hostnames always fail " +
          "with an error, useful for testing subagent error handling.",
        type: FUNCTION_TYPE.EXECUTOR,
        operationType: OPERATION_TYPE.READ,
        parameters: [
          {
            name: "hostname",
            type: PARAMETER_TYPE.STRING,
            description:
              'Service hostname to check. Hosts containing "bad" or "fail" will throw an error.',
            required: true,
          },
        ],
        executor: async (args) => {
          const hostname =
            typeof args.hostname === "string" ? args.hostname.trim().toLowerCase() : "";
          // Simulate flaky behavior based on hostname
          if (hostname.includes("bad") || hostname.includes("fail")) {
            throw new Error(
              `Service health check failed: ${hostname} returned HTTP 503 — upstream connection refused`,
            );
          }
          if (hostname.includes("timeout")) {
            // Simulate a hang that would cause a subagent timeout
            await new Promise((resolve) => setTimeout(resolve, 300_000));
            return { status: "unreachable" };
          }
          return {
            hostname,
            status: "healthy",
            latencyMs: Math.floor(Math.random() * 50) + 5,
            checkedAt: new Date().toISOString(),
          };
        },
      },
      {
        id: "test_subagent_slow_query",
        name: "Test Subagent Slow Query",
        cnName: "测试子智能体-慢查询",
        description:
          "Simulates a slow database query with configurable delay. " +
          "Useful for testing subagent timeout behavior.",
        type: FUNCTION_TYPE.EXECUTOR,
        operationType: OPERATION_TYPE.READ,
        parameters: [
          {
            name: "table",
            type: PARAMETER_TYPE.STRING,
            description: "Table name to query.",
            required: true,
          },
          {
            name: "delaySeconds",
            type: PARAMETER_TYPE.NUMBER,
            description:
              "Simulated query delay in seconds. Default: 3. Set to a very high value to test timeout.",
            required: false,
          },
        ],
        executor: async (args) => {
          const table =
            typeof args.table === "string" ? args.table.trim() : "unknown_table";
          const delay = Math.max(0, Number(args.delaySeconds) || 3);
          await new Promise((resolve) => setTimeout(resolve, delay * 1000));
          return {
            table,
            delaySeconds: delay,
            rowCount: Math.floor(Math.random() * 1000) + 1,
            queryTime: `${delay}s`,
            result: `Query on ${table} completed after ${delay}s simulated delay.`,
          };
        },
      },
    ],
  },
];

export const TEST_STANDALONE_TOOL_IDS = standaloneToolFixtures.map((tool) => tool.id);
export const TEST_SKILL_NAMES = skillFixtures.map((skill) => skill.name);

export type FixturePromptPreset = {
  id: string;
  label: string;
  prompt: string;
  /** When true, this preset requires test fixtures (tools/skills) to be registered. */
  requiresFixtures?: boolean;
  /** When true, this preset requires the subagent feature to be enabled. */
  requiresSubagent?: boolean;
};

export const TEST_FIXTURE_PROMPTS: FixturePromptPreset[] = [
  {
    id: "read-echo",
    label: "调用: read echo",
    requiresFixtures: true,
    prompt:
      "请只调用工具 test_read_echo，并传入 text='fixture hello'、tags=['demo','inline']，不要调用其他工具。",
  },
  {
    id: "dom-render",
    label: "调用: DOM render",
    requiresFixtures: true,
    prompt:
      "请调用工具 test_read_dom_render，并传入 title='Standalone Visual'、values=[12,7,18,9]。",
  },
  {
    id: "read-error",
    label: "调用: read error",
    requiresFixtures: true,
    prompt:
      "请调用工具 test_read_fail，reason='simulate error card'。",
  },
  {
    id: "write-approval",
    label: "调用: write approval",
    requiresFixtures: true,
    prompt:
      "请调用工具 test_write_requires_approval，参数 target='demo-config'、enabled=true。",
  },
  {
    id: "skill-load-ops",
    label: "调用: loadSkill ops",
    requiresFixtures: true,
    prompt:
      "请先调用 loadSkill 加载 test-skill-ops，再调用 test_skill_lookup_orders，customer='alice'。",
  },
  {
    id: "skill-load-visual",
    label: "调用: loadSkill visual",
    requiresFixtures: true,
    prompt:
      "请先调用 loadSkill 加载 test-skill-visual，再调用 test_skill_visual_card，title='Skill Visual Demo'、values=[4,9,6,11]。",
  },
  {
    id: "askuser-all",
    label: "askUser: 全字段表单",
    requiresFixtures: true,
    prompt:
      "请先调用 loadSkill 加载 test-skill-askuser-form，然后调用 test_askuser_get_schemas（formType='all'），" +
      "再用返回的 message 和 schema 调用 askUser，最后把用户填写的结果告诉我。",
  },
  {
    id: "askuser-multiselect",
    label: "askUser: 多选复选框",
    requiresFixtures: true,
    prompt:
      "请先调用 loadSkill 加载 test-skill-askuser-form，然后调用 test_askuser_get_schemas（formType='multiselect'），" +
      "再用返回的 message 和 schema 调用 askUser，最后把用户选择的结果告诉我。",
  },
  {
    id: "askuser-enum-select",
    label: "askUser: 枚举选择",
    requiresFixtures: true,
    prompt:
      "请先调用 loadSkill 加载 test-skill-askuser-form，然后调用 test_askuser_get_schemas（formType='enum-select'），" +
      "再用返回的 message 和 schema 调用 askUser，最后把用户选择的结果告诉我。",
  },
  {
    id: "subagent-single",
    label: "subagent: 单任务",
    requiresFixtures: true,
    requiresSubagent: true,
    prompt:
      "请使用 subagent 工具委派一个子任务：查询 web-01 服务器的指标（使用 test_subagent_server_metrics），" +
      "并根据结果总结该服务器的健康状态。",
  },
  {
    id: "subagent-parallel",
    label: "subagent: 并行任务",
    requiresFixtures: true,
    requiresSubagent: true,
    prompt:
      "请同时委派 3 个 subagent 并行执行以下任务：\n" +
      "1. 查询 web-01 和 api-02 的服务器指标（test_subagent_server_metrics），对比两台服务器的负载\n" +
      "2. 搜索 payment 服务的 ERROR 级别日志（test_subagent_search_logs），分析错误模式\n" +
      "3. 查询用户 alice 的资料（test_subagent_user_profile），并查看她最近的活跃时间\n" +
      "最后请综合所有子任务的结果给我一份简要报告。",
  },
  {
    id: "subagent-research",
    label: "subagent: 深度调研",
    requiresFixtures: true,
    requiresSubagent: true,
    prompt:
      "我怀疑 payment 服务最近有问题。请用 subagent 帮我做一次全面调研：\n" +
      "- 查询 payment 相关的所有日志（不限严重级别）\n" +
      "- 查询 gateway 服务的 ERROR 日志，看看是否有上游连接问题\n" +
      "- 查询 api-02 服务器的指标\n" +
      "请让 subagent 自行决定调用哪些工具，最后给我一份分析报告。",
  },
  {
    id: "subagent-fail",
    label: "subagent: 工具报错",
    requiresFixtures: true,
    requiresSubagent: true,
    prompt:
      "请使用 subagent 委派以下任务：对 bad-server-01 执行健康检查（使用 test_subagent_flaky_service），" +
      "这个服务会报错。请观察 subagent 如何处理工具调用失败的情况，并汇报结果。",
  },
  {
    id: "subagent-timeout",
    label: "subagent: 超时测试",
    requiresFixtures: true,
    requiresSubagent: true,
    prompt:
      "请使用 subagent 委派以下任务：执行一个 test_subagent_slow_query，" +
      "参数 table='audit_logs'、delaySeconds=999。这会模拟一个非常慢的查询，" +
      "用来测试 subagent 超时后的表现。",
  },
  {
    id: "subagent-overflow",
    label: "subagent: 并发超限",
    requiresFixtures: true,
    requiresSubagent: true,
    prompt:
      "请同时委派 8 个 subagent 并行执行以下任务（故意超出并发限制来测试拒绝行为）：\n" +
      "1. 查询 web-01 服务器指标\n" +
      "2. 查询 web-02 服务器指标\n" +
      "3. 查询 api-01 服务器指标\n" +
      "4. 查询 api-02 服务器指标\n" +
      "5. 查询 db-primary 服务器指标\n" +
      "6. 搜索 payment 的 ERROR 日志\n" +
      "7. 搜索 gateway 的 WARN 日志\n" +
      "8. 查询用户 alice 的资料\n" +
      "每个任务都使用 test_subagent_* 系列工具。观察哪些被执行、哪些被拒绝。",
  },
];

export function registerStandaloneToolFixtures(sdk: SDKRegistrar): string[] {
  for (const tool of standaloneToolFixtures) {
    sdk.registerTool(tool);
  }
  return [...TEST_STANDALONE_TOOL_IDS];
}

export function unregisterStandaloneToolFixtures(sdk: SDKRegistrar): void {
  for (const id of TEST_STANDALONE_TOOL_IDS) {
    sdk.unregisterTool(id);
  }
}

export function registerSkillFixtures(sdk: SDKRegistrar): string[] {
  for (const skill of skillFixtures) {
    sdk.registerSkill(skill);
  }
  return [...TEST_SKILL_NAMES];
}

export function unregisterSkillFixtures(sdk: SDKRegistrar): void {
  for (const name of TEST_SKILL_NAMES) {
    sdk.unregisterSkill(name);
  }
}
