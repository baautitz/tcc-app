import { tool, type StructuredToolInterface, type ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";
import type { AuthenticatedUser } from "./auth.js";
import type { DiscoveredColumn, DiscoveredTable, ExternalPostgresConfig } from "./external-postgres.js";
import { MAX_DATA_SOURCE_CATALOG_TABLES } from "./data-source-catalog.js";

export interface AiReadSource {
  id: string;
  name: string;
  databaseName: string;
  context: string;
  connection: ExternalPostgresConfig;
}

export interface AiReadSourceSummary {
  id: string;
  name: string;
}

export interface AiReadTableName {
  id: string;
  dataSourceId: string;
  schemaName: string;
  tableName: string;
}

export interface AiReadTable extends AiReadTableName {
  context: string;
}

export interface AiReadToolsRepository {
  listSources(offset: number, limit: number): Promise<{ sources: AiReadSourceSummary[]; total: number }>;
  findSource(dataSourceId: string): Promise<AiReadSource | undefined>;
  listCatalogTables(dataSourceId: string): Promise<AiReadTableName[]>;
  findCatalogTable(dataSourceId: string, tableId: string): Promise<AiReadTable | undefined>;
  listLiveBaseTables(connection: ExternalPostgresConfig): Promise<DiscoveredTable[]>;
  getLiveColumns(
    connection: ExternalPostgresConfig,
    schemaName: string,
    tableName: string,
  ): Promise<DiscoveredColumn[]>;
}

export type AiToolProgressEvent =
  | { type: "tool_start"; toolCallId: string; toolName: string }
  | { type: "tool_result"; toolCallId: string; toolName: string; ok: boolean };

export interface CreateAiReadToolsOptions {
  currentUser: AuthenticatedUser;
  repository: AiReadToolsRepository;
  onToolEvent?: (event: AiToolProgressEvent) => void | Promise<void>;
}

const dataSourceIdSchema = z.string().uuid().describe("ID do servidor PostgreSQL cadastrado.");
const listSourcesSchema = z.object({
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
const listTablesSchema = z.object({
  dataSourceId: dataSourceIdSchema,
  search: z.string().trim().max(120).optional().describe("Busca por nome da tabela ou schema."),
  schemaName: z.string().trim().min(1).max(255).optional().describe("Filtra por schema exato."),
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
const tableSchemaInput = z.object({
  dataSourceId: dataSourceIdSchema,
  tableId: z.string().uuid().describe("ID da tabela dentro do catálogo deste servidor."),
  columnOffset: z.number().int().min(0).max(1_000).default(0),
  columnLimit: z.number().int().min(1).max(200).default(100),
}).strict();
const MAX_SCHEMA_TOOL_OUTPUT_BYTES = 100_000;
const MAX_LIST_TOOL_OUTPUT_BYTES = 100_000;

type RuntimeWithToolCallId = ToolRuntime & { toolCallId?: string };

function untrustedContext(text: string, maxChars = 2_000): {
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

function tableKey(table: Pick<DiscoveredTable, "schemaName" | "tableName">): string {
  return `${table.schemaName}\u0000${table.tableName}`;
}

function tableNamesMatch(catalog: AiReadTableName[], live: DiscoveredTable[]): boolean {
  if (catalog.length !== live.length) return false;
  const catalogNames = new Set(catalog.map(tableKey));
  return live.every((table) => catalogNames.has(tableKey(table)));
}

async function withToolEvents<T>(
  name: string,
  runtime: RuntimeWithToolCallId,
  onToolEvent: CreateAiReadToolsOptions["onToolEvent"],
  execute: () => Promise<T>,
): Promise<T> {
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
  } finally {
    await emit({ type: "tool_result", toolCallId, toolName: name, ok });
  }
}

export function createAiReadTools({
  currentUser,
  repository,
  onToolEvent,
}: CreateAiReadToolsOptions): StructuredToolInterface[] {
  if (!currentUser.isAdmin) {
    throw new Error("As ferramentas de contexto estão disponíveis apenas para administradores.");
  }

  const requireSource = async (dataSourceId: string): Promise<AiReadSource> => {
    const source = await repository.findSource(dataSourceId);
    if (!source) throw new Error("Servidor PostgreSQL não encontrado.");
    return source;
  };

  const requireFreshCatalog = async (source: AiReadSource): Promise<{
    catalog: AiReadTableName[];
    liveTables: DiscoveredTable[];
  }> => {
    let catalog: AiReadTableName[];
    let liveTables: DiscoveredTable[];
    try {
      [catalog, liveTables] = await Promise.all([
        repository.listCatalogTables(source.id),
        repository.listLiveBaseTables(source.connection),
      ]);
    } catch {
      throw new Error("Não foi possível validar o catálogo deste servidor PostgreSQL.");
    }
    if (catalog.length > MAX_DATA_SOURCE_CATALOG_TABLES || liveTables.length > MAX_DATA_SOURCE_CATALOG_TABLES) {
      throw new Error(`O catálogo excede o limite de ${MAX_DATA_SOURCE_CATALOG_TABLES} tabelas.`);
    }
    if (!tableNamesMatch(catalog, liveTables)) {
      throw new Error("O catálogo está desatualizado. Atualize as tabelas do servidor antes de consultar o esquema.");
    }
    return { catalog, liveTables };
  };

  const listSources = tool(async (input, runtime) => withToolEvents(
    "list_data_sources",
    runtime as RuntimeWithToolCallId,
    onToolEvent,
    async () => {
      const result = await repository.listSources(input.offset, input.limit);
      const output = {
        total: result.total,
        offset: input.offset,
        limit: input.limit,
        sources: result.sources.slice(0, input.limit).map((source) => ({
          id: source.id,
          name: source.name,
        })),
      };
      if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_LIST_TOOL_OUTPUT_BYTES) {
        throw new Error("A página de servidores excede o limite de saída.");
      }
      return output;
    },
  ), {
    name: "list_data_sources",
    description: "Lista e pagina os servidores de dados disponíveis ao administrador por ID e nome. Não retorna host, usuário, senha, credenciais ou contextos.",
    schema: listSourcesSchema,
  });

  const listTables = tool(async (input, runtime) => withToolEvents(
    "list_data_source_tables",
    runtime as RuntimeWithToolCallId,
    onToolEvent,
    async () => {
      const source = await requireSource(input.dataSourceId);
      const { catalog, liveTables } = await requireFreshCatalog(source);
      const normalizedSearch = input.search?.toLocaleLowerCase("pt-BR");
      const filtered = catalog
        .filter((table) => input.schemaName === undefined || table.schemaName === input.schemaName)
        .filter((table) => !normalizedSearch
          || table.tableName.toLocaleLowerCase("pt-BR").includes(normalizedSearch)
          || table.schemaName.toLocaleLowerCase("pt-BR").includes(normalizedSearch))
        .sort((left, right) => left.schemaName.localeCompare(right.schemaName)
          || left.tableName.localeCompare(right.tableName));
      const schemas = [...new Set(liveTables.map((table) => table.schemaName))].sort();
      const result = {
        dataSource: {
          id: source.id,
          name: source.name,
        },
        schemas: schemas.slice(0, 100),
        schemaCount: schemas.length,
        schemasTruncated: schemas.length > 100,
        total: filtered.length,
        offset: input.offset,
        limit: input.limit,
        tables: filtered.slice(input.offset, input.offset + input.limit).map((table) => ({
          id: table.id,
          schemaName: table.schemaName,
          tableName: table.tableName,
        })),
      };
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_LIST_TOOL_OUTPUT_BYTES) {
        throw new Error("A página de tabelas excede o limite de saída.");
      }
      return result;
    },
  ), {
    name: "list_data_source_tables",
    description: "Lista e pagina tabelas catalogadas de um servidor, permitindo busca por schema ou tabela. Retorna somente IDs e nomes, nunca contextos ou linhas de dados; exige catálogo atualizado.",
    schema: listTablesSchema,
  });

  const getTableSchema = tool(async (input, runtime) => withToolEvents(
    "get_data_source_table_schema",
    runtime as RuntimeWithToolCallId,
    onToolEvent,
    async () => {
      const source = await requireSource(input.dataSourceId);
      const { liveTables } = await requireFreshCatalog(source);
      const table = await repository.findCatalogTable(input.dataSourceId, input.tableId);
      if (!table) throw new Error("Tabela catalogada não encontrada neste servidor.");
      if (!liveTables.some((live) => live.schemaName === table.schemaName && live.tableName === table.tableName)) {
        throw new Error("Tabela catalogada não encontrada neste servidor.");
      }

      let columns: DiscoveredColumn[];
      try {
        columns = await repository.getLiveColumns(source.connection, table.schemaName, table.tableName);
      } catch {
        throw new Error("Não foi possível ler as colunas desta tabela.");
      }
      if (columns.length === 0) {
        throw new Error("A tabela não possui colunas visíveis para o usuário PostgreSQL configurado.");
      }
      const result = {
        dataSource: {
          id: source.id,
          name: source.name,
          context: untrustedContext(source.context),
        },
        table: {
          id: table.id,
          schemaName: table.schemaName,
          tableName: table.tableName,
          context: untrustedContext(table.context),
        },
        totalColumns: columns.length,
        columnOffset: input.columnOffset,
        columnLimit: input.columnLimit,
        truncated: input.columnOffset + input.columnLimit < columns.length,
        nextColumnOffset: input.columnOffset + input.columnLimit < columns.length
          ? input.columnOffset + input.columnLimit
          : null,
        columns: columns.slice(input.columnOffset, input.columnOffset + input.columnLimit).map((column) => ({
          name: column.columnName,
          dataType: column.dataType,
          udtName: column.udtName,
          nullable: column.nullable,
          ordinalPosition: column.ordinalPosition,
        })),
      };
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_SCHEMA_TOOL_OUTPUT_BYTES) {
        throw new Error("O resultado de metadados excede o limite. Reduza o número de colunas por página.");
      }
      return result;
    },
  ), {
    name: "get_data_source_table_schema",
    description: "Lê os nomes, tipos PostgreSQL (incluindo udtName para enum/array/domínio), nulabilidade e ordem das colunas de uma tabela. A saída é paginada (máximo 200 colunas e 100 KB); os dois contextos somam no máximo 4.000 caracteres e cada contexto informa se foi truncado. Não retorna valores, defaults ou linhas de dados; os IDs precisam pertencer ao mesmo catálogo atualizado.",
    schema: tableSchemaInput,
  });

  return [listSources, listTables, getTableSchema];
}
