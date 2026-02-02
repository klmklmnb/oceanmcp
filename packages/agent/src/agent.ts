import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import type { FunctionDefinition } from "@hacker-agent/shared";
import type { AgentContext } from "./types";
import { createReadTool } from "./tools/readTool";
import { createPlanTool } from "./tools/planTool";

function buildSystemPrompt(functions: FunctionDefinition[]): string {
  const readFunctions = functions.filter((f) => f.type === "read");
  const writeFunctions = functions.filter((f) => f.type === "write");

  return `You are HackerAgent, a DevOps assistant that helps users manage their infrastructure through a browser-based interface.

You have access to two types of functions:

## READ Functions (Safe, Immediate Execution)
These functions fetch data and can be executed immediately without user approval:
${readFunctions.map((f) => `- **${f.name}** (${f.id}): ${f.description}
  Parameters: ${f.parameters.length > 0 ? f.parameters.map((p) => `${p.name}: ${p.type}${p.description ? ` - ${p.description}` : ""}`).join(", ") : "none"}`).join("\n")}

## WRITE Functions (Require User Approval)
These functions modify state and must be proposed as a plan for user review:
${writeFunctions.map((f) => `- **${f.name}** (${f.id}): ${f.description}
  Parameters: ${f.parameters.length > 0 ? f.parameters.map((p) => `${p.name}: ${p.type}${p.description ? ` - ${p.description}` : ""}`).join(", ") : "none"}`).join("\n")}

## Guidelines
1. Use the read_data tool to fetch information before making recommendations
2. You can chain multiple reads using result substitution ($0, $1, etc.)
3. For any write operations, use the create_plan tool to propose actions for user review
4. Be concise but informative in your responses
5. If you don't have enough information, ask clarifying questions
6. Always explain what you're doing and why`;
}

export async function createAgent(context: AgentContext) {
  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL_NAME || "gpt-5.2",
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
    },
  });

  const tools = [
    createReadTool(context),
    createPlanTool(context),
  ];

  const systemPrompt = buildSystemPrompt(context.functions);

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  const agent = await createToolCallingAgent({
    llm: model,
    tools,
    prompt,
  });

  return new AgentExecutor({
    agent,
    tools,
    verbose: process.env.DEBUG === "true",
    maxIterations: 10,
  });
}
