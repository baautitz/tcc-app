import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./client.js";

const migrationFile = fileURLToPath(new URL("./migrations/0000_initial.sql", import.meta.url));

try {
  await pool.query(await readFile(migrationFile, "utf8"));
  console.info("Migração inicial aplicada com sucesso.");
} finally {
  await pool.end();
}
