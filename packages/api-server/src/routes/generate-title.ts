import { generateText } from "ai";
import { getLanguageModel } from "../ai/providers";
import { logger } from "../logger";

interface TitleMessage {
  role: string;
  text: string;
}

type PreferredLanguage = "zh" | "en";

function stripInternalTags(input: string): string {
  return input
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<\/?think>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMeaningfulSentence(input: string): string {
  const normalized = stripInternalTags(input)
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  const candidates = normalized
    .split(/[。！？!?；;\n]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return candidates[0] ?? normalized;
}

function normalizeForPrompt(input: string, maxLen: number): string {
  return stripInternalTags(input).replace(/\s+/g, " ").slice(0, maxLen).trim();
}

function detectPreferredLanguage(input: string): PreferredLanguage {
  const hanCount = (input.match(/[\u4E00-\u9FFF]/g) ?? []).length;
  const latinCount = (input.match(/[A-Za-z]/g) ?? []).length;
  if (hanCount > 0 && hanCount * 2 >= latinCount) return "zh";
  return "en";
}

function normalizeGeneratedTitle(raw: string, maxLen: number): string {
  const singleLine = raw.trim().split("\n")[0]?.trim() ?? "";
  return singleLine
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/^[a-z]+:\s*/i, "")
    .trim()
    .slice(0, maxLen);
}

function matchesPreferredLanguage(
  title: string,
  preferredLanguage: PreferredLanguage,
): boolean {
  const hasHan = /[\u4E00-\u9FFF]/.test(title);
  const hasLatin = /[A-Za-z]/.test(title);
  if (preferredLanguage === "zh") return hasHan;
  return hasLatin || !hasHan;
}

function deriveFallbackTitle(
  messages: TitleMessage[],
  preferredLanguage: PreferredLanguage,
): string {
  const firstUserText =
    messages.find((m) => m.role === "user" && m.text?.trim())?.text?.trim() ??
    messages.find((m) => m.text?.trim())?.text?.trim() ??
    "";
  const normalized = firstUserText.replace(/\s+/g, " ");
  if (preferredLanguage === "zh") {
    return normalized.replace(/[。！？!?].*$/u, "").slice(0, 20);
  }
  return normalized.slice(0, 50);
}

export async function handleGenerateTitleRequest(
  req: Request,
): Promise<Response> {
  try {
    const body = await req.json();
    const messages: TitleMessage[] = body?.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json(
        { error: "messages array is required" },
        { status: 400 },
      );
    }

    const firstUserText = normalizeForPrompt(
      messages.find((m) => m.role === "user" && m.text?.trim())?.text ?? "",
      500,
    );
    const firstAssistantText = firstMeaningfulSentence(
      messages.find((m) => m.role === "assistant" && m.text?.trim())?.text ?? "",
    ).slice(0, 200);
    const snippet = [
      firstUserText ? `user: ${firstUserText}` : "",
      firstAssistantText ? `assistant: ${firstAssistantText}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    if (!snippet) {
      return Response.json(
        { error: "no text content in messages" },
        { status: 400 },
      );
    }

    const preferredLanguage = detectPreferredLanguage(snippet);
    const maxTitleLength = preferredLanguage === "zh" ? 20 : 50;

    const { text } = await generateText({
      model: getLanguageModel("fast"),
      prompt:
        "Generate a concise but self-explanatory chat title from the conversation.\n" +
        "Rules:\n" +
        "1) Output ONLY the title.\n" +
        "2) The title language MUST match the conversation language.\n" +
        "3) Prioritize the user's intent; treat assistant text as secondary context.\n" +
        "4) The title must be understandable as a standalone phrase.\n" +
        "5) Do NOT output keyword lists or noun-only fragments.\n" +
        "6) If the user asks to do something, keep the core action verb.\n" +
        "7) If assistant content is an introduction, capability list, or long enumeration, compress it into one high-level intent phrase instead of listing items.\n" +
        "8) For informational/meta questions, prefer abstract intent titles (e.g., capability overview, usage explanation) rather than copied assistant wording.\n" +
        "9) The title MUST be a declarative phrase, NOT a question.\n" +
        "10) Avoid vague titles that only restate the question (e.g., '能做什么', '可以做什么', 'What can you do').\n" +
        "11) Include a concrete scope noun when possible (e.g., 功能/能力/服务/操作).\n" +
        "12) Do NOT start with conversational prefaces, apologies, or assistant self-references.\n" +
        "13) No quotes, no markdown, no trailing punctuation.\n" +
        `14) Keep it under ${maxTitleLength} characters.\n\n` +
        "Conversation:\n" +
        snippet,
    });

    let title = normalizeGeneratedTitle(text, maxTitleLength);
    if (!matchesPreferredLanguage(title, preferredLanguage)) {
      title = deriveFallbackTitle(messages, preferredLanguage);
    }
    if (!title) {
      title = preferredLanguage === "zh" ? "新会话" : "New Session";
    }

    return Response.json({ title });
  } catch (error) {
    logger.error("[generate-title] Failed:", error);
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Title generation failed",
      },
      { status: 500 },
    );
  }
}
