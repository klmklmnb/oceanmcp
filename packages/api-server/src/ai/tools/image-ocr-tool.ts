import { tool, generateText } from "ai";
import { z } from "zod";
import { getLanguageModel } from "../providers";

export const imageOcr = tool({
  description:
    "Perform OCR or content extraction on an image via a vision LLM. Returns the extracted text or structured content.",
  inputSchema: z.object({
    model: z
      .string()
      .optional()
      .describe(
        "Vision model ID to use (e.g. qwen3-vl-235b-fp8). Defaults to the configured LLM_MODEL.",
      ),
    prompt: z
      .string()
      .optional()
      .describe(
        "Instruction for the model (e.g. '请提取这张图片中的所有文字内容，并整理成 JSON 格式。'). Defaults to extracting all text.",
      ),
    imageUrl: z.string().url().describe("Public URL of the image to process."),
  }),
  execute: async ({ model, prompt, imageUrl }) => {
    const llm = getLanguageModel(model ?? "qwen3-vl-30b-a3b-instruct-fp8");
    const userPrompt = prompt ?? "请提取这张图片中的所有文字内容";
    const { text } = await generateText({
      model: llm,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image", image: new URL(imageUrl) },
          ],
        },
      ],
    });
    return { result: text };
  },
});
