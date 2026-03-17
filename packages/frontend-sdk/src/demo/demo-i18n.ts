// ─── Demo Page Internationalization ──────────────────────────────────────────
// Detects browser locale and provides English / Chinese strings for the demo UI.

export type DemoLocale = "en" | "zh";

export function detectLocale(): DemoLocale {
  const lang = navigator.language?.toLowerCase() ?? "";
  return lang.startsWith("zh") ? "zh" : "en";
}

const strings = {
  en: {
    // Navbar
    title: "OceanMCP",
    subtitle: "Browser-in-the-Loop AI Agent SDK",
    tabForm: "Form",
    tabTodo: "TODO List",
    tabFlow: "React Flow",

    // Form tab
    formTitle: "Form Builder",
    formDescription:
      "Ask the AI to create dynamic forms — contact forms, surveys, feedback forms, or any custom schema. The AI generates JSON Schema definitions and previews them live.",
    formSuggestion1: "Create a contact form",
    formSuggestion1Text:
      "Create a contact form with name, email, phone, and message fields. Preview it in the Form Preview area, then let me fill it out.",
    formSuggestion2: "Build a survey",
    formSuggestion2Text:
      "Build a customer satisfaction survey with rating, feedback textarea, and recommendation radio buttons. Preview it and collect my responses.",
    formSuggestion3: "Design a bug report form",
    formSuggestion3Text:
      "Design a bug report form with title, severity (critical/high/medium/low), steps to reproduce (textarea), and expected vs actual behavior. Preview it for me to fill out.",
    formPreviewTitle: "Form Preview",
    formPreviewEmpty: "Ask the AI to create a form — it will appear here.",

    // TODO tab
    todoTitle: "TODO List",
    todoDescription:
      "Let the AI manage your TODO list. It can add tasks, mark them complete, set priorities, and organize your workflow — all through browser-side tool calls.",
    todoSuggestion1: "Plan a sprint",
    todoSuggestion1Text:
      "Add 5 tasks for a two-week sprint: set up CI/CD pipeline (high), write unit tests (high), refactor auth module (medium), update documentation (low), and design review (medium). Set appropriate due dates.",
    todoSuggestion2: "What's my task list?",
    todoSuggestion2Text: "Show me the current TODO list and summarize the status of each task.",
    todoSuggestion3: "Clean up completed",
    todoSuggestion3Text: "Remove all completed tasks from the TODO list and give me a summary of what was cleared.",
    todoEmpty: "No tasks yet. Ask the AI to add some!",
    todoPending: "Pending",
    todoInProgress: "In Progress",
    todoDone: "Done",
    todoPriorityHigh: "High",
    todoPriorityMedium: "Medium",
    todoPriorityLow: "Low",

    // Flow tab
    flowTitle: "React Flow Editor",
    flowDescription:
      "The AI can create and edit flow diagrams by calling browser-side tools. Ask it to build pipelines, decision trees, or any node-edge graph.",
    flowSuggestion1: "Build a CI/CD pipeline",
    flowSuggestion1Text:
      "Create a CI/CD pipeline flow diagram with these steps: Code Push -> Lint & Test -> Build -> Staging Deploy -> Manual Approval -> Production Deploy. Use input node for the first step and output node for the last. Connect them with labeled edges.",
    flowSuggestion2: "Add a decision node",
    flowSuggestion2Text:
      "Add a decision diamond node labeled 'Tests Pass?' in the middle of the flow. Connect it to a 'Deploy' node on the yes path and a 'Fix & Retry' node on the no path.",
    flowSuggestion3: "Design a microservice architecture",
    flowSuggestion3Text:
      "Create a microservice architecture diagram with: API Gateway (input), Auth Service, User Service, Order Service, Payment Service, Notification Service, and Database (output). Connect them showing the request flow.",
    flowEmpty: "Ask the AI to create a flow diagram — nodes will appear here.",
  },

  zh: {
    // Navbar
    title: "OceanMCP",
    subtitle: "Browser-in-the-Loop AI 智能体 SDK",
    tabForm: "表单",
    tabTodo: "待办列表",
    tabFlow: "React Flow",

    // Form tab
    formTitle: "表单构建器",
    formDescription:
      "让 AI 创建动态表单 — 联系表单、调查问卷、反馈表等。AI 生成 JSON Schema 定义并实时预览。",
    formSuggestion1: "创建联系表单",
    formSuggestion1Text:
      "创建一个包含姓名、邮箱、电话和留言字段的联系表单。在表单预览区展示，然后让我填写。",
    formSuggestion2: "构建问卷调查",
    formSuggestion2Text:
      "构建一个客户满意度调查问卷，包含评分、反馈文本框和推荐单选按钮。预览后让我填写。",
    formSuggestion3: "设计 Bug 报告表单",
    formSuggestion3Text:
      "设计一个 Bug 报告表单，包含标题、严重程度（严重/高/中/低）、复现步骤（文本域）、预期行为和实际行为。预览后让我填写。",
    formPreviewTitle: "表单预览",
    formPreviewEmpty: "让 AI 创建表单 — 它将在这里显示。",

    // TODO tab
    todoTitle: "待办列表",
    todoDescription:
      "让 AI 管理你的待办列表。它可以添加任务、标记完成、设置优先级，并通过浏览器端工具调用来组织你的工作流。",
    todoSuggestion1: "规划一个 Sprint",
    todoSuggestion1Text:
      "添加 5 个两周 Sprint 的任务：搭建 CI/CD 流水线（高优先级）、编写单元测试（高）、重构认证模块（中）、更新文档（低）、设计评审（中）。设置合适的截止日期。",
    todoSuggestion2: "查看任务列表",
    todoSuggestion2Text: "展示当前待办列表，并总结每个任务的状态。",
    todoSuggestion3: "清理已完成任务",
    todoSuggestion3Text: "从待办列表中移除所有已完成的任务，并给我一个清理摘要。",
    todoEmpty: "暂无任务。让 AI 添加一些吧！",
    todoPending: "待处理",
    todoInProgress: "进行中",
    todoDone: "已完成",
    todoPriorityHigh: "高",
    todoPriorityMedium: "中",
    todoPriorityLow: "低",

    // Flow tab
    flowTitle: "React Flow 编辑器",
    flowDescription:
      "AI 可以通过调用浏览器端工具来创建和编辑流程图。让它构建流水线、决策树或任何节点边图。",
    flowSuggestion1: "构建 CI/CD 流水线",
    flowSuggestion1Text:
      "创建一个 CI/CD 流水线流程图，包含以下步骤：代码推送 -> 检查 & 测试 -> 构建 -> 预发布部署 -> 人工审批 -> 生产部署。第一步使用 input 节点，最后一步使用 output 节点，用带标签的边连接它们。",
    flowSuggestion2: "添加决策节点",
    flowSuggestion2Text:
      "在流程中间添加一个标记为 '测试通过？' 的决策节点。将其连接到 '是' 路径的 '部署' 节点和 '否' 路径的 '修复 & 重试' 节点。",
    flowSuggestion3: "设计微服务架构",
    flowSuggestion3Text:
      "创建一个微服务架构图，包含：API 网关（input）、认证服务、用户服务、订单服务、支付服务、通知服务和数据库（output）。用连线展示请求流向。",
    flowEmpty: "让 AI 创建流程图 — 节点会在这里显示。",
  },
};

export type DemoStrings = Record<keyof typeof strings["en"], string>;

export function getStrings(locale: DemoLocale): DemoStrings {
  return strings[locale];
}
