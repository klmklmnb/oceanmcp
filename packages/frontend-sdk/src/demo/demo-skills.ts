// ─── Demo Skill & Tool Definitions ───────────────────────────────────────────
// All skills/tools for the three demo tabs: Form, TODO, and Flow.
// These demonstrate the power of OceanMCP's browser-side tool execution.

import {
  FUNCTION_TYPE,
  OPERATION_TYPE,
  type ExecutorFunctionDefinition,
} from "oceanmcp-shared";
import type { SkillDefinition } from "../registry/skill-registry";
import { todoStore, flowStore, formStore } from "./demo-store";

// ─── Form Builder Skill ──────────────────────────────────────────────────────

function createFormTools(): ExecutorFunctionDefinition[] {
  return [
    {
      id: "getFormTemplates",
      name: "Get Form Templates",
      cnName: "获取表单模板",
      description:
        "Returns a list of built-in form templates (contact, survey, feedback) with their JSON Schema definitions. Use these as starting points or inspiration for creating custom forms.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.READ,
      parameters: [],
      executor: async () => {
        return {
          templates: [
            {
              name: "contact",
              title: "Contact Form",
              schema: {
                type: "object",
                required: ["name", "email", "message"],
                properties: {
                  name: { type: "string", title: "Full Name", description: "Your full name" },
                  email: { type: "string", title: "Email", format: "email", description: "your@email.com" },
                  phone: { type: "string", title: "Phone Number", description: "Optional phone number" },
                  message: { type: "string", title: "Message", format: "textarea", description: "How can we help you?" },
                },
              },
            },
            {
              name: "survey",
              title: "Customer Satisfaction Survey",
              schema: {
                type: "object",
                required: ["rating", "recommend"],
                properties: {
                  rating: {
                    type: "string",
                    title: "Overall Rating",
                    enum: ["excellent", "good", "average", "poor"],
                    enumLabels: { excellent: "Excellent", good: "Good", average: "Average", poor: "Poor" },
                  },
                  recommend: {
                    type: "string",
                    title: "Would you recommend us?",
                    enum: ["yes", "no"],
                    enumLabels: { yes: "Yes", no: "No" },
                  },
                  feedback: { type: "string", title: "Additional Feedback", format: "textarea" },
                },
              },
            },
            {
              name: "feedback",
              title: "Product Feedback",
              schema: {
                type: "object",
                required: ["product", "category"],
                properties: {
                  product: { type: "string", title: "Product Name" },
                  category: {
                    type: "string",
                    title: "Feedback Category",
                    enum: ["bug", "feature", "improvement", "other"],
                    enumLabels: { bug: "Bug Report", feature: "Feature Request", improvement: "Improvement", other: "Other" },
                  },
                  priority: {
                    type: "string",
                    title: "Priority",
                    enum: ["low", "medium", "high", "critical"],
                    enumLabels: { low: "Low", medium: "Medium", high: "High", critical: "Critical" },
                  },
                  description: { type: "string", title: "Description", format: "textarea", description: "Describe your feedback in detail" },
                },
              },
            },
          ],
        };
      },
    },
    {
      id: "previewForm",
      name: "Preview Form",
      cnName: "预览表单",
      description:
        "Takes a JSON Schema form definition and renders it in the Form Preview area on the page. " +
        "Use this to show the user what the form looks like before collecting data. " +
        "The schema should follow JSON Schema draft-7 format with type: 'object' and properties.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.WRITE,
      autoApprove: true,
      parameters: {
        type: "object",
        required: ["schema", "title"],
        properties: {
          title: {
            type: "string",
            description: "Form title displayed above the preview",
          },
          schema: {
            type: "object",
            description:
              "JSON Schema object defining the form fields. Must have type: 'object' and properties. " +
              "Supported property types: string, number, boolean. " +
              "Supported formats: textarea, email, date, time. " +
              "Use enum for select/radio fields, enumLabels for display names.",
          },
        },
        additionalProperties: false,
      },
      executor: async (args) => {
        const schema = args.schema;
        const title = typeof args.title === "string" ? args.title : "Form Preview";
        formStore.setSchema(schema, title);
        const fieldCount = schema?.properties ? Object.keys(schema.properties).length : 0;
        return {
          success: true,
          title,
          fieldCount,
          message: `Form "${title}" with ${fieldCount} fields is now displayed in the preview area.`,
        };
      },
    },
    {
      id: "collectFormData",
      name: "Collect Form Data",
      cnName: "收集表单数据",
      description:
        "Collects form data from the user using the askUser interactive form. " +
        "Pass a JSON Schema to define the form fields. The user will fill in the form and submit it. " +
        "The collected data is returned as the tool result. " +
        "IMPORTANT: You must call the askUser tool directly with the schema, not this tool. " +
        "This tool is for recording submitted form data in the preview area.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.WRITE,
      autoApprove: true,
      parameters: {
        type: "object",
        required: ["data"],
        properties: {
          data: {
            type: "object",
            description: "The submitted form data to record.",
          },
        },
        additionalProperties: false,
      },
      executor: async (args) => {
        const data = args.data ?? {};
        formStore.setSubmission(data);
        return {
          success: true,
          recordedFields: Object.keys(data).length,
          data,
          message: "Form submission recorded successfully.",
        };
      },
    },
  ];
}

export function createFormSkill(): SkillDefinition {
  return {
    name: "demo-form-builder",
    cnName: "表单构建器",
    description:
      "Build and preview dynamic forms. Create contact forms, surveys, feedback forms, or custom forms with various field types. " +
      "Use getFormTemplates to see available templates, previewForm to display a form on the page, " +
      "and askUser to collect form responses interactively.",
    instructions: `
# Form Builder Demo

You are a form builder assistant. You can create dynamic forms and display them in the preview area.

## Workflow

1. **Get Templates**: Call \`getFormTemplates\` to see built-in templates for inspiration.
2. **Design the Form**: Based on the user's request, create a JSON Schema definition.
3. **Preview**: Call \`previewForm\` with the schema and title to show it in the preview area.
4. **Collect Data**: Use the \`askUser\` tool with the same schema to collect responses from the user interactively.
5. **Record**: After the user submits, call \`collectFormData\` to record the submission in the preview area.

## JSON Schema Format

The form schema uses JSON Schema draft-7 format:

\`\`\`json
{
  "type": "object",
  "required": ["field1"],
  "properties": {
    "field1": { "type": "string", "title": "Display Name", "description": "Placeholder text" },
    "field2": { "type": "string", "title": "Long Text", "format": "textarea" },
    "field3": { "type": "string", "title": "Select", "enum": ["a", "b"], "enumLabels": {"a": "Option A", "b": "Option B"} },
    "field4": { "type": "number", "title": "Age" },
    "field5": { "type": "boolean", "title": "Agree?", "enumLabels": {"true": "Yes", "false": "No"} },
    "field6": { "type": "string", "title": "Date", "format": "date" },
    "field7": { "type": "array", "title": "Tags", "items": { "enum": ["a","b","c"] } }
  }
}
\`\`\`

## Tips
- Always preview the form first before collecting data
- Use descriptive titles and descriptions for each field
- Mark important fields as required
- Use enumLabels for user-friendly select option display names
`,
    tools: createFormTools(),
  };
}

// ─── TODO Manager Skill ──────────────────────────────────────────────────────

function createTodoTools(): ExecutorFunctionDefinition[] {
  return [
    {
      id: "getTodoList",
      name: "Get TODO List",
      cnName: "获取待办列表",
      description:
        "Returns the current TODO list with all items, their statuses, priorities, and due dates. " +
        "Optionally filter by status or priority.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.READ,
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: 'Filter by status: "pending", "in-progress", or "done"',
            enum: ["pending", "in-progress", "done"],
          },
          priority: {
            type: "string",
            description: 'Filter by priority: "high", "medium", or "low"',
            enum: ["high", "medium", "low"],
          },
        },
        additionalProperties: false,
      },
      executor: async (args) => {
        let items = todoStore.getAll();
        if (args.status) items = items.filter((t) => t.status === args.status);
        if (args.priority) items = items.filter((t) => t.priority === args.priority);
        return {
          total: todoStore.getAll().length,
          filtered: items.length,
          items,
        };
      },
    },
    {
      id: "addTodo",
      name: "Add TODO",
      cnName: "添加待办",
      description:
        "Adds a new TODO item to the list. The item appears immediately on the page. " +
        "Set priority to 'high', 'medium', or 'low' and optionally include a due date.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.WRITE,
      autoApprove: true,
      parameters: {
        type: "object",
        required: ["title"],
        properties: {
          title: {
            type: "string",
            description: "Task title",
          },
          description: {
            type: "string",
            description: "Optional task description with more details",
          },
          priority: {
            type: "string",
            description: "Task priority",
            enum: ["high", "medium", "low"],
            default: "medium",
          },
          dueDate: {
            type: "string",
            description: "Due date in YYYY-MM-DD format",
            format: "date",
          },
        },
        additionalProperties: false,
      },
      executor: async (args) => {
        const item = todoStore.add({
          title: args.title,
          description: args.description,
          status: "pending",
          priority: args.priority || "medium",
          dueDate: args.dueDate,
        });
        return {
          success: true,
          item,
          message: `Added "${item.title}" (${item.priority} priority) to the TODO list.`,
        };
      },
    },
    {
      id: "updateTodo",
      name: "Update TODO",
      cnName: "更新待办",
      description:
        "Updates an existing TODO item. Can change its status (pending/in-progress/done), " +
        "priority, title, description, or due date. The change reflects immediately on the page.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.WRITE,
      autoApprove: true,
      parameters: {
        type: "object",
        required: ["id"],
        properties: {
          id: {
            type: "string",
            description: "The TODO item ID (e.g., 'todo-1')",
          },
          title: { type: "string", description: "New title" },
          description: { type: "string", description: "New description" },
          status: {
            type: "string",
            description: "New status",
            enum: ["pending", "in-progress", "done"],
          },
          priority: {
            type: "string",
            description: "New priority",
            enum: ["high", "medium", "low"],
          },
          dueDate: {
            type: "string",
            description: "New due date (YYYY-MM-DD)",
            format: "date",
          },
        },
        additionalProperties: false,
      },
      executor: async (args) => {
        const { id, ...updates } = args;
        const item = todoStore.update(id, updates);
        if (!item) {
          return { success: false, error: `TODO item "${id}" not found.` };
        }
        return {
          success: true,
          item,
          message: `Updated "${item.title}" successfully.`,
        };
      },
    },
    {
      id: "deleteTodo",
      name: "Delete TODO",
      cnName: "删除待办",
      description:
        "Permanently deletes a TODO item from the list. This action cannot be undone.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.WRITE,
      parameters: {
        type: "object",
        required: ["id"],
        properties: {
          id: {
            type: "string",
            description: "The TODO item ID to delete",
          },
        },
        additionalProperties: false,
      },
      executor: async (args) => {
        const deleted = todoStore.delete(args.id);
        if (!deleted) {
          return { success: false, error: `TODO item "${args.id}" not found.` };
        }
        return {
          success: true,
          message: `Deleted TODO item "${args.id}".`,
          remaining: todoStore.getAll().length,
        };
      },
    },
    {
      id: "clearCompletedTodos",
      name: "Clear Completed TODOs",
      cnName: "清除已完成待办",
      description: "Removes all TODO items with status 'done' from the list.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.WRITE,
      parameters: [],
      executor: async () => {
        const removed = todoStore.clearCompleted();
        return {
          success: true,
          removedCount: removed,
          remaining: todoStore.getAll().length,
          message: `Cleared ${removed} completed task(s).`,
        };
      },
    },
  ];
}

export function createTodoSkill(): SkillDefinition {
  return {
    name: "demo-todo-manager",
    cnName: "待办管理器",
    description:
      "Manage a visual TODO list on the page. Add, update, complete, and delete tasks " +
      "with priorities and due dates. Changes are reflected immediately in the UI.",
    instructions: `
# TODO List Manager Demo

You are a task management assistant. You can manage a visual TODO list displayed on the page.

## Available Tools

| Tool | Type | Description |
|------|------|-------------|
| getTodoList | read | Get current tasks (optionally filter by status/priority) |
| addTodo | write (auto) | Add a new task with title, priority, optional due date |
| updateTodo | write (auto) | Update task status, priority, title, etc. |
| deleteTodo | write | Permanently delete a task (requires approval) |
| clearCompletedTodos | write | Remove all completed tasks |

## Status Flow

\`pending\` → \`in-progress\` → \`done\`

## Tips

- Always check the current list with \`getTodoList\` before making bulk changes
- When the user asks to "complete" a task, update its status to "done"
- When adding multiple tasks, call \`addTodo\` for each one
- Use descriptive titles — they're displayed prominently in the UI
- Set realistic due dates when the user provides time constraints
- Priority levels: "high" (urgent), "medium" (normal), "low" (nice to have)
`,
    tools: createTodoTools(),
  };
}

// ─── React Flow Editor Skill ─────────────────────────────────────────────────

function createFlowTools(): ExecutorFunctionDefinition[] {
  return [
    {
      id: "getFlowState",
      name: "Get Flow State",
      cnName: "获取流程状态",
      description:
        "Returns the current state of the flow diagram — all nodes and edges with their properties.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.READ,
      parameters: [],
      executor: async () => {
        const state = flowStore.getState();
        return {
          nodeCount: state.nodes.length,
          edgeCount: state.edges.length,
          nodes: state.nodes,
          edges: state.edges,
        };
      },
    },
    {
      id: "addFlowNode",
      name: "Add Flow Node",
      cnName: "添加流程节点",
      description:
        "Adds a new node to the flow diagram. Specify the label, position, and node type. " +
        "The node appears immediately on the canvas. " +
        "Use type 'input' for starting nodes, 'output' for end nodes, and 'default' for intermediate steps.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.WRITE,
      autoApprove: true,
      parameters: {
        type: "object",
        required: ["label"],
        properties: {
          id: {
            type: "string",
            description: "Optional custom node ID. Auto-generated if not provided.",
          },
          label: {
            type: "string",
            description: "Text displayed inside the node",
          },
          type: {
            type: "string",
            description: "Node type: 'input' (start), 'default' (middle), 'output' (end)",
            enum: ["input", "default", "output"],
            default: "default",
          },
          x: {
            type: "number",
            description: "X position on the canvas (pixels from left). Default: auto-calculated.",
          },
          y: {
            type: "number",
            description: "Y position on the canvas (pixels from top). Default: auto-calculated.",
          },
          backgroundColor: {
            type: "string",
            description: "Optional background color (CSS color value, e.g. '#e0f2fe' or 'lightyellow')",
          },
          borderColor: {
            type: "string",
            description: "Optional border color (CSS color value)",
          },
        },
        additionalProperties: false,
      },
      executor: async (args) => {
        const nodeCount = flowStore.getState().nodes.length;
        const x = typeof args.x === "number" ? args.x : 50 + (nodeCount % 4) * 200;
        const y = typeof args.y === "number" ? args.y : 50 + Math.floor(nodeCount / 4) * 120;
        const style: Record<string, string | number> = {};
        if (args.backgroundColor) style.background = args.backgroundColor;
        if (args.borderColor) {
          style.border = `2px solid ${args.borderColor}`;
        }
        const node = flowStore.addNode({
          id: args.id,
          type: args.type || "default",
          data: { label: args.label },
          position: { x, y },
          ...(Object.keys(style).length > 0 ? { style } : {}),
        });
        return {
          success: true,
          node,
          message: `Added node "${args.label}" at position (${x}, ${y}).`,
        };
      },
    },
    {
      id: "updateFlowNode",
      name: "Update Flow Node",
      cnName: "更新流程节点",
      description:
        "Updates an existing node's label, position, type, or style. The change is reflected immediately on the canvas.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.WRITE,
      autoApprove: true,
      parameters: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Node ID to update" },
          label: { type: "string", description: "New label text" },
          type: {
            type: "string",
            description: "New node type",
            enum: ["input", "default", "output"],
          },
          x: { type: "number", description: "New X position" },
          y: { type: "number", description: "New Y position" },
          backgroundColor: { type: "string", description: "New background color" },
          borderColor: { type: "string", description: "New border color" },
        },
        additionalProperties: false,
      },
      executor: async (args) => {
        const updates: any = {};
        if (args.label) updates.data = { label: args.label };
        if (args.type) updates.type = args.type;
        if (typeof args.x === "number" || typeof args.y === "number") {
          const current = flowStore.getState().nodes.find((n) => n.id === args.id);
          updates.position = {
            x: typeof args.x === "number" ? args.x : current?.position.x ?? 0,
            y: typeof args.y === "number" ? args.y : current?.position.y ?? 0,
          };
        }
        if (args.backgroundColor || args.borderColor) {
          updates.style = {};
          if (args.backgroundColor) updates.style.background = args.backgroundColor;
          if (args.borderColor) updates.style.border = `2px solid ${args.borderColor}`;
        }
        const node = flowStore.updateNode(args.id, updates);
        if (!node) {
          return { success: false, error: `Node "${args.id}" not found.` };
        }
        return { success: true, node, message: `Updated node "${args.id}".` };
      },
    },
    {
      id: "deleteFlowNode",
      name: "Delete Flow Node",
      cnName: "删除流程节点",
      description:
        "Removes a node and all its connected edges from the flow diagram.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.WRITE,
      parameters: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Node ID to delete" },
        },
        additionalProperties: false,
      },
      executor: async (args) => {
        const deleted = flowStore.deleteNode(args.id);
        if (!deleted) {
          return { success: false, error: `Node "${args.id}" not found.` };
        }
        return { success: true, message: `Deleted node "${args.id}" and its connected edges.` };
      },
    },
    {
      id: "addFlowEdge",
      name: "Add Flow Edge",
      cnName: "添加流程连线",
      description:
        "Creates a connection (edge) between two nodes. Optionally add a label and animation.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.WRITE,
      autoApprove: true,
      parameters: {
        type: "object",
        required: ["source", "target"],
        properties: {
          source: { type: "string", description: "Source node ID" },
          target: { type: "string", description: "Target node ID" },
          label: { type: "string", description: "Optional label displayed on the edge" },
          animated: { type: "boolean", description: "Whether the edge is animated (dashed moving line)", default: false },
        },
        additionalProperties: false,
      },
      executor: async (args) => {
        const state = flowStore.getState();
        if (!state.nodes.find((n) => n.id === args.source)) {
          return { success: false, error: `Source node "${args.source}" not found.` };
        }
        if (!state.nodes.find((n) => n.id === args.target)) {
          return { success: false, error: `Target node "${args.target}" not found.` };
        }
        const edge = flowStore.addEdge({
          source: args.source,
          target: args.target,
          label: args.label,
          animated: args.animated ?? false,
        });
        return {
          success: true,
          edge,
          message: `Connected "${args.source}" → "${args.target}"${args.label ? ` (${args.label})` : ""}.`,
        };
      },
    },
    {
      id: "deleteFlowEdge",
      name: "Delete Flow Edge",
      cnName: "删除流程连线",
      description: "Removes an edge (connection) from the flow diagram.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.WRITE,
      parameters: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Edge ID to delete" },
        },
        additionalProperties: false,
      },
      executor: async (args) => {
        const deleted = flowStore.deleteEdge(args.id);
        if (!deleted) {
          return { success: false, error: `Edge "${args.id}" not found.` };
        }
        return { success: true, message: `Deleted edge "${args.id}".` };
      },
    },
    {
      id: "layoutFlow",
      name: "Auto Layout Flow",
      cnName: "自动布局流程图",
      description:
        "Automatically arranges all nodes in a grid layout for better readability.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.WRITE,
      autoApprove: true,
      parameters: [],
      executor: async () => {
        flowStore.autoLayout();
        const state = flowStore.getState();
        return {
          success: true,
          nodeCount: state.nodes.length,
          message: `Auto-arranged ${state.nodes.length} nodes in a grid layout.`,
        };
      },
    },
    {
      id: "clearFlow",
      name: "Clear Flow",
      cnName: "清空流程图",
      description: "Removes all nodes and edges from the flow diagram. Cannot be undone.",
      type: FUNCTION_TYPE.EXECUTOR,
      operationType: OPERATION_TYPE.WRITE,
      parameters: [],
      executor: async () => {
        flowStore.clear();
        return { success: true, message: "Flow diagram cleared." };
      },
    },
  ];
}

export function createFlowSkill(): SkillDefinition {
  return {
    name: "demo-flow-editor",
    cnName: "流程图编辑器",
    description:
      "Create and edit flow diagrams on the page. Add nodes (input/default/output), " +
      "connect them with edges, and build visual workflows, pipelines, and architecture diagrams. " +
      "Changes appear instantly on the interactive canvas.",
    instructions: `
# React Flow Editor Demo

You are a flow diagram assistant. You can create and edit interactive flow diagrams displayed on the page canvas.

## Available Tools

| Tool | Type | Description |
|------|------|-------------|
| getFlowState | read | Get all current nodes and edges |
| addFlowNode | write (auto) | Add a node with label, position, type, and style |
| updateFlowNode | write (auto) | Update a node's properties |
| deleteFlowNode | write | Delete a node and its edges (requires approval) |
| addFlowEdge | write (auto) | Connect two nodes with an edge |
| deleteFlowEdge | write | Delete an edge (requires approval) |
| layoutFlow | write (auto) | Auto-arrange nodes in a grid |
| clearFlow | write | Clear the entire canvas (requires approval) |

## Node Types

- **input**: Green border, used for starting/source nodes
- **default**: Standard node for intermediate steps
- **output**: Red border, used for final/sink nodes

## Positioning Strategy

The canvas is roughly 800×600 pixels. When creating a flow:

1. Start input nodes at the top (y: 50) or left (x: 50)
2. Space nodes ~200px apart horizontally, ~120px vertically
3. Keep related nodes close together
4. Use \`layoutFlow\` to auto-arrange if positioning gets messy

## Styling

- Use \`backgroundColor\` for semantic coloring (e.g., light blue for info, light yellow for warnings)
- Use \`borderColor\` to highlight important nodes
- Use \`animated: true\` on edges to show active/in-progress connections

## Best Practices

- Always check current state with \`getFlowState\` before editing existing diagrams
- Create all nodes first, then add edges to connect them
- Use meaningful labels — they're displayed inside the nodes
- Add edge labels for branching logic (e.g., "yes"/"no" on decision paths)
`,
    tools: createFlowTools(),
  };
}
