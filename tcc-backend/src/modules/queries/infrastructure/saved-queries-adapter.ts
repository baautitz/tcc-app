import type { SavedQueriesPort } from "../domain/saved-queries-port.js";
import { createQueryLifecycleRepository } from "./query-lifecycle-repository.js";
import { savedQueriesRepository } from "./saved-queries-repository.js";

export const savedQueriesAdapter: SavedQueriesPort = {
  listParametersByIds: (ids) => savedQueriesRepository.listParametersByIds(ids),
  listAllIds: () => savedQueriesRepository.listAllIds(),
  findReceipt: (id) => savedQueriesRepository.findReceipt(id),
  listWithSourcesByIds: (ids, tx) => savedQueriesRepository.listWithSourcesByIds(ids, tx),
  createLifecycleRepository: () => createQueryLifecycleRepository(),
};
