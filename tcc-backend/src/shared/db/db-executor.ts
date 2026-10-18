import { sql } from "drizzle-orm";
import { db } from "./client.js";

export type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Transaction serialised against every dashboard-file mutation. */
export function withDashboardFilesLock<T>(work: (tx: DbExecutor) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tcc-app:dashboard-files'))`);
    return work(tx);
  });
}
