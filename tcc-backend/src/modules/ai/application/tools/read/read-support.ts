import { z } from "zod";
import type { ToolRuntime } from "@langchain/core/tools";
import { DomainError } from "../../../../../shared/lib/domain-error.js";
import type { DiscoveredTable } from "../../../../data-sources/infrastructure/external-pg/index.js";
import type { AiReadTableName, AiToolProgressEvent, CreateAiReadToolsOptions } from "./read-types.js";

export const dataSourceIdSchema = z.string().uuid().describe("ID do servidor PostgreSQL cadastrado.");
export const listSourcesSchema = z.object({
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
export const listTablesSchema = z.object({
  dataSourceId: dataSourceIdSchema,
  search: z.string().trim().max(120).optional().describe("Busca por nome da tabela ou schema."),
  schemaName: z.string().trim().min(1).max(255).optional().describe("Filtra por schema exato."),
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
export const tableSchemaInput = z.object({
  dataSourceId: dataSourceIdSchema,
  tableId: z.string().uuid().describe("ID da tabela dentro do catálogo deste servidor."),
  columnOffset: z.number().int().min(0).max(1_000).default(0),
  columnLimit: z.number().int().min(1).max(200).default(100),
}).strict();
export const dateCoverageInput = z.object({
  dataSourceId: dataSourceIdSchema,
  tableId: z.string().uuid().describe("ID da tabela dentro do catálogo deste servidor."),
  columnName: z.string().trim().min(1).max(255).describe("Nome exato de uma coluna temporal retornada pelo esquema da tabela."),
}).strict();
export const columnValuesInput = z.object({
  dataSourceId: dataSourceIdSchema,
  tableId: z.string().uuid().describe("ID da tabela dentro do catálogo deste servidor."),
  columnName: z.string().trim().min(1).max(255).describe("Nome exato da coluna de dimensão retornada pelo esquema."),
  limit: z.number().int().min(5).max(40).default(20),
}).strict();
export const MAX_SCHEMA_TOOL_OUTPUT_BYTES = 100_000;
export const MAX_LIST_TOOL_OUTPUT_BYTES = 100_000;
export const PROFILE_VALUE_CHARACTERS = 120;
export const PROFILE_DATA_TYPES = new Set([
  "text", "character varying", "character", "smallint", "integer", "bigint",
  "numeric", "real", "double precision", "boolean",
]);
export const PROFILE_UDT_NAMES = new Set([
  "text", "varchar", "bpchar", "int2", "int4", "int8", "numeric", "float4", "float8", "bool",
]);
export const SENSITIVE_PROFILE_COLUMN = /(^|_)(email|e_mail|cpf|cnpj|phone|telephone|address|street|password|secret|token|document|card_number|credit_card|first_name|last_name|full_name|person_name|user_name|customer_name|contact_name|id)(_|$)/i;
export const TEMPORAL_DATA_TYPES = new Set([
  "date",
  "timestamp without time zone",
  "timestamp with time zone",
  "time without time zone",
  "time with time zone",
  "interval",
]);
export const TEMPORAL_UDT_NAMES = new Set([
  "date",
  "timestamp",
  "timestamptz",
  "time",
  "timetz",
  "interval",
]);

export type RuntimeWithToolCallId = ToolRuntime & { toolCallId?: string };

export function untrustedContext(text: string, maxChars = 2_000): {
  trust: "untrusted_metadata";
  text: string;
  truncated: boolean;
} {
  return {
    trust: "untrusted_metadata",
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
  };
}

export function tableKey(table: Pick<DiscoveredTable, "schemaName" | "tableName">): string {
  return `${table.schemaName}\u0000${table.tableName}`;
}

export function tableNamesMatch(catalog: AiReadTableName[], live: DiscoveredTable[]): boolean {
  if (catalog.length !== live.length) return false;
  const catalogNames = new Set(catalog.map(tableKey));
  return live.every((table) => catalogNames.has(tableKey(table)));
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function withToolEvents<T>(
  name: string,
  runtime: RuntimeWithToolCallId,
  onToolEvent: CreateAiReadToolsOptions["onToolEvent"],
  execute: () => Promise<T>,
): Promise<T | { ok: false; code: "DATA_SOURCE_NOT_FOUND"; message: string; instruction: string }> {
  const toolCallId = runtime.toolCallId ?? crypto.randomUUID();
  const emit = async (event: AiToolProgressEvent) => {
    try {
      await onToolEvent?.(event);
    } catch {
      // Progress delivery must not change the result of a read-only tool.
    }
  };
  await emit({ type: "tool_start", toolCallId, toolName: name });
  let ok = false;
  try {
    const result = await execute();
    ok = true;
    return result;
  } catch (error) {
    if (runtime.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw error;
    }
    if (error instanceof AiReadSourceNotFoundError) {
      return {
        ok: false,
        code: "DATA_SOURCE_NOT_FOUND",
        message: "O servidor usado nesta leitura não está mais disponível no catálogo atual.",
        instruction: "Chame list_data_sources, escolha exatamente um ID retornado agora e refaça a leitura. Não reutilize IDs antigos do histórico.",
      };
    }
    throw error;
  } finally {
    await emit({ type: "tool_result", toolCallId, toolName: name, ok });
  }
}

export class AiReadSourceNotFoundError extends DomainError {
  constructor() {
    super("Servidor PostgreSQL não encontrado.", "DATA_SOURCE_NOT_FOUND", "not_found");
    this.name = "AiReadSourceNotFoundError";
  }
}
