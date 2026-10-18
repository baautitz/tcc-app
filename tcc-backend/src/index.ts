import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { getEnvironment } from "./shared/config/config.js";
import { pool } from "./shared/db/client.js";
import { ensureSystemPermissions } from "./modules/identity/application/permissions.js";

const environment = getEnvironment();

await ensureSystemPermissions();
const server = serve({ fetch: app.fetch, port: environment.PORT });
console.info(`tcc-backend ouvindo em http://localhost:${environment.PORT}`);

async function shutdown(): Promise<void> {
  server.close();
  await pool.end();
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
