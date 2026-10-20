import type { DbExecutor } from "../../../shared/db/db-executor.js";
import type {
  dashboardProposalReceipts,
  dataSources,
  savedQueries,
} from "../../../shared/db/schema.js";
import type { QueryLifecycleRepository } from "./query-lifecycle.js";

/** Porta de leitura de queries salvas para outros modulos; implementada em queries/infrastructure e injetada na composicao. */
export interface SavedQueriesPort {
  listParametersByIds(ids: string[]): Promise<
    Array<{
      id: string;
      parameters: (typeof savedQueries.$inferSelect)["parameters"];
    }>
  >;
  listAllIds(): Promise<Array<{ id: string }>>;
  findReceipt(
    receiptId: string,
  ): Promise<typeof dashboardProposalReceipts.$inferSelect | undefined>;
  listWithSourcesByIds(
    ids: string[],
    tx?: DbExecutor,
  ): Promise<
    Array<{
      query: typeof savedQueries.$inferSelect;
      source: typeof dataSources.$inferSelect;
    }>
  >;
  createLifecycleRepository(): QueryLifecycleRepository;
}
