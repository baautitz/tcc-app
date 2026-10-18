import type { SavedQueriesPort } from "../domain/saved-queries-port.js";

let port: SavedQueriesPort | undefined;
export function configureSavedQueries(p: SavedQueriesPort): void {
  port = p;
}
export function savedQueriesPort(): SavedQueriesPort {
  if (!port) throw new Error("SavedQueriesPort não configurada.");
  return port;
}
