import { z } from "zod";
import { parameterDefinitionSchema } from "../../lib/contracts.js";
import type { AiChatRole } from "../ai-agent.js";

const chatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(8_000),
  })
  .strict();

const pageContextSchema = z
  .object({
    pathname: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (pathname) => pathname.startsWith("/") && !pathname.startsWith("//"),
        "A rota informada é inválida.",
      ),
    dashboardId: z.string().uuid().optional(),
    dashboardName: z.string().trim().min(1).max(160).optional(),
  })
  .strict()
  .optional();

export const continuationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("query_saved"),
      queryId: z.string().uuid(),
      queryName: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      type: z.literal("dashboard_saved"),
      dashboardId: z.string().uuid(),
      dashboardName: z.string().trim().min(1).max(200),
      mode: z.enum(["create", "update"]),
    })
    .strict(),
]);

export const savedQueryReferenceSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
  })
  .strict();

export const pendingQueryPreviewSchema = z
  .object({
    testRunId: z.string().uuid(),
    queryName: z.string().trim().min(1).max(160),
    purpose: z.enum(["dashboard", "quick_query"]).optional(),
    dataSource: z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(160),
      })
      .strict(),
    sqlText: z.string().max(60_000),
    parameters: z.array(parameterDefinitionSchema).max(50),
    testValues: z.record(
      z.string().max(80),
      z.union([z.string().max(2048), z.array(z.string().max(2048)).max(50)]),
    ),
  })
  .strict();

export const chatRequestSchema = z
  .object({
    threadId: z.string().uuid().optional(),
    messages: z.array(chatMessageSchema).min(1).max(30),
    pageContext: pageContextSchema,
    continuation: continuationSchema.optional(),
    savedQueries: z.array(savedQueryReferenceSchema).max(20).optional(),
    pendingQueryPreviews: z.array(pendingQueryPreviewSchema).max(3).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const totalCharacters = value.messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );
    if (totalCharacters > 32_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A conversa excede o tamanho permitido.",
      });
    }
    if (value.messages.at(-1)?.role !== "user") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A última mensagem deve ser do usuário.",
      });
    }
  });

export const MAX_CHAT_REQUEST_BYTES = 160 * 1024;

export type AiChatRequest = z.infer<typeof chatRequestSchema>;
export type AiChatMessages = Array<{ role: AiChatRole; content: string }>;
