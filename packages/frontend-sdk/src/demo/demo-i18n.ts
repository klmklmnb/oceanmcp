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
      'Preview a contact form with these fields: Name (string, required), Email (string, email format, required), Phone (string), Inquiry Type (enum: "sales", "support", "partnership", "other" with labels "Sales", "Technical Support", "Partnership", "Other", required), and Message (textarea, required). ' +
      "After previewing, use askUser to collect my responses. Pre-fill Name as \"Alice Chen\", Email as \"alice@example.com\", Phone as \"555-0123\", and Message as \"I'd like to learn more about OceanMCP SDK integration.\" — but leave Inquiry Type empty so I can choose it myself.",
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
    todoSuggestion1: "Finish the CI/CD setup",
    todoSuggestion1Text:
      "The CI/CD pipeline task is currently in progress — mark it as done and give me a summary of what's left on my list.",
    todoSuggestion2: "What's my task list?",
    todoSuggestion2Text: "Show me the current TODO list and summarize the status of each task. How many are pending, in progress, or done?",
    todoSuggestion3: "Reprioritize my tasks",
    todoSuggestion3Text: "Review my pending tasks and reprioritize them. The database query refactor is now urgent — set it to high priority. Also clean up any completed tasks.",
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

    // Query Table tab
    tabTable: "Query Table",
    tableTitle: "Order Query Table",
    tableDescription:
      "An e-commerce order dashboard with 13 filters. Tell the AI what you're looking for in natural language — it will set the appropriate filter values and the table updates instantly.",
    tableSuggestion1: "Show high-value European orders",
    tableSuggestion1Text:
      "Show me all orders shipped to Europe with an amount over $200. I want to see which products and customers are driving high-value European sales.",
    tableSuggestion2: "Find cancelled electronics orders",
    tableSuggestion2Text:
      "Filter the table to show only cancelled or refunded orders in the Electronics category. I want to analyze our return patterns.",
    tableSuggestion3: "Mobile orders with coupons",
    tableSuggestion3Text:
      "Show me all orders placed from mobile platforms (iOS and Android) where a coupon was used. I want to see how effective our mobile promotions are.",
    tableEmpty: "No orders match the current filters. Try adjusting the criteria.",
    tableResetFilters: "Reset Filters",
    tableShowingResults: "results",
    tableOf: "of",
    tableOrders: "orders",
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
      '预览一个联系表单，包含以下字段：姓名（字符串，必填）、邮箱（字符串，email 格式，必填）、电话（字符串）、咨询类型（枚举："sales"、"support"、"partnership"、"other"，显示标签为"销售咨询"、"技术支持"、"合作洽谈"、"其他"，必填）和留言（textarea，必填）。' +
      '预览后使用 askUser 收集我的回答。预填姓名为 "Alice Chen"、邮箱为 "alice@example.com"、电话为 "555-0123"、留言为 "我想了解更多关于 OceanMCP SDK 集成的信息。" — 但咨询类型留空让我自己选择。',
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
    todoSuggestion1: "完成 CI/CD 搭建",
    todoSuggestion1Text:
      "CI/CD 流水线任务正在进行中 — 把它标记为已完成，然后给我总结一下待办列表里还剩什么。",
    todoSuggestion2: "查看任务列表",
    todoSuggestion2Text: "展示当前待办列表，并总结每个任务的状态。有多少待处理、进行中、已完成？",
    todoSuggestion3: "调整任务优先级",
    todoSuggestion3Text: "检查我的待处理任务并重新排列优先级。数据库查询重构现在很紧急 — 设为高优先级。同时清理所有已完成的任务。",
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

    // Query Table tab
    tabTable: "查询表格",
    tableTitle: "订单查询表",
    tableDescription:
      "一个包含 13 个筛选条件的电商订单面板。用自然语言告诉 AI 你想查找什么 — 它会自动设置对应的筛选值，表格即时更新。",
    tableSuggestion1: "查看欧洲高价订单",
    tableSuggestion1Text:
      "展示所有发往欧洲且金额超过 200 美元的订单。我想看看哪些产品和客户带来了高价值的欧洲销售。",
    tableSuggestion2: "查找已取消的电子产品订单",
    tableSuggestion2Text:
      "筛选表格只显示电子产品类别中已取消或已退款的订单。我想分析我们的退货模式。",
    tableSuggestion3: "使用优惠券的移动端订单",
    tableSuggestion3Text:
      "展示所有从移动端平台（iOS 和 Android）下单且使用了优惠券的订单。我想看看移动端促销的效果如何。",
    tableEmpty: "没有匹配当前筛选条件的订单。请尝试调整筛选条件。",
    tableResetFilters: "重置筛选",
    tableShowingResults: "条结果",
    tableOf: "/",
    tableOrders: "条订单",
  },
};

export type DemoStrings = Record<keyof typeof strings["en"], string>;

export function getStrings(locale: DemoLocale): DemoStrings {
  return strings[locale];
}
