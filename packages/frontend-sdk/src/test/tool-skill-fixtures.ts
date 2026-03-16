import type { FunctionDefinition } from "@ocean-mcp/shared";
import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  PARAMETER_TYPE,
} from "@ocean-mcp/shared";
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
];

export const TEST_STANDALONE_TOOL_IDS = standaloneToolFixtures.map((tool) => tool.id);
export const TEST_SKILL_NAMES = skillFixtures.map((skill) => skill.name);

export type FixturePromptPreset = {
  id: string;
  label: string;
  prompt: string;
};

export const TEST_FIXTURE_PROMPTS: FixturePromptPreset[] = [
  {
    id: "read-echo",
    label: "调用: read echo",
    prompt:
      "请只调用工具 test_read_echo，并传入 text='fixture hello'、tags=['demo','inline']，不要调用其他工具。",
  },
  {
    id: "dom-render",
    label: "调用: DOM render",
    prompt:
      "请调用工具 test_read_dom_render，并传入 title='Standalone Visual'、values=[12,7,18,9]。",
  },
  {
    id: "read-error",
    label: "调用: read error",
    prompt:
      "请调用工具 test_read_fail，reason='simulate error card'。",
  },
  {
    id: "write-approval",
    label: "调用: write approval",
    prompt:
      "请调用工具 test_write_requires_approval，参数 target='demo-config'、enabled=true。",
  },
  {
    id: "skill-load-ops",
    label: "调用: loadSkill ops",
    prompt:
      "请先调用 loadSkill 加载 test-skill-ops，再调用 test_skill_lookup_orders，customer='alice'。",
  },
  {
    id: "skill-load-visual",
    label: "调用: loadSkill visual",
    prompt:
      "请先调用 loadSkill 加载 test-skill-visual，再调用 test_skill_visual_card，title='Skill Visual Demo'、values=[4,9,6,11]。",
  },
  {
    id: "askuser-all",
    label: "askUser: 全字段表单",
    prompt:
      "请先调用 loadSkill 加载 test-skill-askuser-form，然后调用 test_askuser_get_schemas（formType='all'），" +
      "再用返回的 message 和 schema 调用 askUser，最后把用户填写的结果告诉我。",
  },
  {
    id: "askuser-multiselect",
    label: "askUser: 多选复选框",
    prompt:
      "请先调用 loadSkill 加载 test-skill-askuser-form，然后调用 test_askuser_get_schemas（formType='multiselect'），" +
      "再用返回的 message 和 schema 调用 askUser，最后把用户选择的结果告诉我。",
  },
  {
    id: "askuser-enum-select",
    label: "askUser: 枚举选择",
    prompt:
      "请先调用 loadSkill 加载 test-skill-askuser-form，然后调用 test_askuser_get_schemas（formType='enum-select'），" +
      "再用返回的 message 和 schema 调用 askUser，最后把用户选择的结果告诉我。",
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
