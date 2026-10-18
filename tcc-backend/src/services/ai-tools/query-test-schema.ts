import type { AuthenticatedUser } from "../auth.js";
import { z } from "zod";
import { parameterDefinitionSchema } from "../../shared/lib/contracts.js";
import type { UnsafeAiColumnType } from "../external-postgres.js";
import type { AiReadSource, AiReadTableName, AiToolProgressEvent } from "../ai-read-tools.js";
import type { AiCatalogTableReference } from "../query-security.js";
import type { QueryLifecycleQuery } from "../query-lifecycle.js";

export const MAX_SQL_DRAFT_CHARACTERS = 100_000;
export const MAX_DATABASE_ATTEMPTS = 12;

export const inputSchema = z
  .object({
    dataSourceId: z
      .string()
      .uuid()
      .describe(
        "ID de um servidor PostgreSQL cadastrado, obtido pela ferramenta list_data_sources.",
      ),
    mode: z.enum(["create", "update"]).default("create").describe(
      "A intenção da revisão: create para salvar nova query ou update para editar uma query existente.",
    ),
    purpose: z.enum(["dashboard", "quick_query"]).describe(
      "Obrigatório. Use dashboard sempre que o administrador pedir para adicionar/criar um gráfico, tabela, indicador ou métrica em um dashboard, inclusive quando indicar a posição em relação a um componente existente (por exemplo, ao lado, acima ou abaixo), mesmo que a query seja criada primeiro. Use quick_query somente para consulta/análise sem pedido de alteração do dashboard.",
    ),
    queryId: z.string().uuid().optional().describe(
      "ID da query existente que será editada; obrigatório quando mode=update. Nunca invente este ID.",
    ),
    queryName: z.string().trim().min(2).max(160).optional().describe(
      "Nome proposto para a query; em edição, omitido mantém o nome salvo atual.",
    ),
    sqlText: z
      .string()
      .trim()
      .min(8)
      .max(MAX_SQL_DRAFT_CHARACTERS)
      .describe(
        "Rascunho PostgreSQL somente leitura começando por SELECT ou WITH; parâmetros devem usar {{nome}}.",
      ),
    parameters: z
      .array(parameterDefinitionSchema)
      .max(50)
      .default([])
      .describe(
        "Definições dos parâmetros {{nome}} usados pelo SQL. Preserve required: parâmetros opcionais continuam required=false.",
      ),
    values: z
      .record(
        z.string(),
        z.union([
          z.string().max(2_048),
          z.array(z.string().max(2_048)).max(50),
        ]),
      )
      .default({})
      .describe(
        "Valores informados pelo administrador. Não invente valores para parâmetros obrigatórios ausentes. Parâmetro multi_select opcional sem seleção será ligado como array vazio; a SQL deve tratar lista vazia como ausência do filtro.",
      ),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode === "update" && !input.queryId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["queryId"],
        message: "Informe o ID da query que será editada.",
      });
    }
    if (input.mode === "create" && input.queryId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["queryId"],
        message: "Uma nova query não pode apontar para uma query existente.",
      });
    }
    if (Object.keys(input.values).length > 50)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["values"],
        message: "O máximo é 50 valores de parâmetros.",
      });
  });

export interface AiQueryTestRepository {
  findSource(dataSourceId: string): Promise<AiReadSource | undefined>;
  listCatalogTables(dataSourceId: string): Promise<AiReadTableName[]>;
  listLiveBaseTables(
    connection: AiReadSource["connection"],
  ): Promise<Array<{ schemaName: string; tableName: string }>>;
  findUnsafeColumnTypes(
    connection: AiReadSource["connection"],
    tables: AiCatalogTableReference[],
  ): Promise<UnsafeAiColumnType[]>;
  findSourceVersion(
    dataSourceId: string,
  ): Promise<{ updatedAt: Date; targetHash: string } | undefined>;
  findQueryTarget(queryId: string): Promise<Pick<QueryLifecycleQuery, "id" | "dataSourceId" | "name" | "updatedAt"> | undefined>;
  createTestReceipt(input: {
    actorId: string;
    dataSourceId: string;
    sourceUpdatedAt: Date;
    sourceTargetHash: string;
    draftFingerprint: string;
    mode: "create" | "update";
    queryId?: string;
    queryUpdatedAt?: Date;
  }): Promise<string>;
}

export interface AiQueryTestResult {
  rows: Record<string, unknown>[];
  rowLimit: number;
  byteLimit: number;
  bytes: number;
  truncated: boolean;
  truncationReason: "row_limit" | "byte_limit" | null;
}

export interface CreateAiQueryTestToolsOptions {
  currentUser: AuthenticatedUser;
  repository: AiQueryTestRepository;
  onToolEvent?: (event: AiToolProgressEvent) => void | Promise<void>;
  runQuery?: (
    source: AiReadSource,
    sqlText: string,
    values: unknown[],
    beforeAttempt: (attempt: number) => boolean,
    signal?: AbortSignal,
  ) => Promise<AiQueryTestResult>;
}
