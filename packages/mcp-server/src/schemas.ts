import { z } from "zod";

export const FunctionDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: z.enum(["read", "write"]),
  code: z.string(),
  parameters: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      description: z.string().optional(),
    })
  ),
});

export const SyncRegistrySchema = z.object({
  type: z.literal("SYNC_REGISTRY"),
  functions: z.array(FunctionDefinitionSchema),
});

export const ReadResultItemSchema = z.object({
  id: z.string(),
  result: z.unknown(),
  error: z.string().optional(),
});

export const ReadResultSchema = z.object({
  type: z.literal("READ_RESULT"),
  requestId: z.string(),
  results: z.array(ReadResultItemSchema),
});

export const FlowNodeSchema = z.object({
  id: z.string(),
  functionId: z.string(),
  title: z.string(),
  arguments: z.record(z.unknown()),
  status: z.enum(["pending", "running", "success", "failed"]),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export const FlowResultSchema = z.object({
  type: z.literal("FLOW_RESULT"),
  planId: z.string(),
  results: z.array(FlowNodeSchema),
});

export const ChatMessageSchema = z.object({
  type: z.literal("CHAT"),
  sessionId: z.string(),
  message: z.string(),
});

export const ClientEventSchema = z.discriminatedUnion("type", [
  SyncRegistrySchema,
  ReadResultSchema,
  FlowResultSchema,
  ChatMessageSchema,
]);

export type ValidatedClientEvent = z.infer<typeof ClientEventSchema>;
