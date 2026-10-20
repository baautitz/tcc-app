import type { DbExecutor } from "../../../shared/db/db-executor.js";
import type { QueryLifecycleRepository } from "../domain/query-lifecycle.js";
import type { SavedQueriesPort } from "../domain/saved-queries-port.js";
import { queryLifecycleRepository } from "./query-lifecycle-repository.js";
import {
  savedQueriesRepository,
  type SavedQueriesRepository,
} from "./saved-queries-repository.js";

export class SavedQueriesAdapter implements SavedQueriesPort {
  constructor(
    private readonly repo: SavedQueriesRepository,
    private readonly lifecycle: QueryLifecycleRepository,
  ) {}

  listParametersByIds(ids: string[]) {
    return this.repo.listParametersByIds(ids);
  }
  listAllIds() {
    return this.repo.listAllIds();
  }
  findReceipt(id: string) {
    return this.repo.findReceipt(id);
  }
  listWithSourcesByIds(ids: string[], tx?: DbExecutor) {
    return this.repo.listWithSourcesByIds(ids, tx);
  }
  createLifecycleRepository() {
    return this.lifecycle;
  }
}

export const savedQueriesAdapter = new SavedQueriesAdapter(
  savedQueriesRepository,
  queryLifecycleRepository,
);
