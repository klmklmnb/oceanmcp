import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import type { FunctionDefinition } from "@hacker-agent/shared";
import type { AgentContext } from "./types";
import { createReadTool } from "./tools/readTool";
import { createPlanTool } from "./tools/planTool";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function formatFunctionList(functions: FunctionDefinition[]): string {
  return functions
    .map(
      (f) => `- **${f.name}** (${f.id}): ${f.description}
  Parameters: ${
    f.parameters.length > 0
      ? f.parameters
          .map(
            (p) =>
              `${p.name}: ${p.type}${
                p.description ? ` - ${p.description}` : ""
              }`
          )
          .join(", ")
      : "none"
  }`
    )
    .join("\n");
}

function buildSystemPrompt(functions: FunctionDefinition[]): string {
  const readFunctions = functions.filter((f) => f.type === "read");
  const writeFunctions = functions.filter((f) => f.type === "write");

  const promptTemplate = readFileSync(join(__dirname, "prompt.md"), "utf-8");

  const populated = promptTemplate
    .replace("{{ READ_FUNCTION_LIST }}", formatFunctionList(readFunctions))
    .replace("{{ WRITE_FUNCTION_LIST }}", formatFunctionList(writeFunctions));

  // Escape curly braces for LangChain's f-string template parser
  // { -> {{ and } -> }} (except for our known variables which are handled by MessagesPlaceholder)
  return populated.replace(/\{/g, "{{").replace(/\}/g, "}}");
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

  const tools = [createReadTool(context), createPlanTool(context)];

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
    handleParsingErrors: (error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `Tool call failed with schema validation error: ${errorMessage}

Please fix the tool input and try again. Make sure all required fields are provided with correct types.`;
    },
  });
}
