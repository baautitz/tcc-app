import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./client.js";

const migrations = [
  {
    id: "0000_initial",
    path: fileURLToPath(new URL("./migrations/0000_initial.sql", import.meta.url)),
  },
  {
    id: "0001_query_test_runs",
    path: fileURLToPath(new URL("./migrations/0001_query_test_runs.sql", import.meta.url)),
  },
  {
    id: "0002_dashboard_proposal_receipts",
    path: fileURLToPath(new URL("./migrations/0002_dashboard_proposal_receipts.sql", import.meta.url)),
  },
];

const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('tcc-app:migrations'))");
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id varchar(120) PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const [index, migration] of migrations.entries()) {
    const recorded = await client.query<{ id: string }>(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [migration.id],
    );
    if (recorded.rowCount) continue;

    // Older installations ran 0000_initial.sql directly and have no ledger.
    if (index === 0) {
      const existing = await client.query<{ tables: Array<string | null> }>(`
        SELECT
          ARRAY[
            to_regclass('public.users')::text,
            to_regclass('public.permissions')::text,
            to_regclass('public.dashboards')::text,
            to_regclass('public.user_permissions')::text,
            to_regclass('public.dashboard_users')::text,
            to_regclass('public.sessions')::text,
            to_regclass('public.data_sources')::text,
            to_regclass('public.data_source_tables')::text,
            to_regclass('public.saved_queries')::text
          ] AS tables
      `);
      const relations = existing.rows[0]?.tables ?? [];
      const installed = relations.every(Boolean);
      if (installed) {
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING", [migration.id]);
        continue;
      }
      if (relations.some(Boolean)) {
        throw new Error("O schema existente está incompleto; 0000_initial não será reaplicada sobre tabelas parciais.");
      }
    }

    await client.query("BEGIN");
    try {
      await client.query(await readFile(migration.path, "utf8"));
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
      await client.query("COMMIT");
      console.info(`Migração ${migration.id} aplicada com sucesso.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('tcc-app:migrations'))").catch(() => undefined);
  client.release();
  await pool.end();
}
