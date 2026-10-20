import { getEnvironment } from "../../../shared/config/config.js";
import type { dataSources } from "../../../shared/db/schema.js";
import { decryptCredential } from "../../../shared/lib/credentials.js";
import type { ExternalPostgresConfig } from "./external-pg/index.js";

export function sourceConnection(
  source: typeof dataSources.$inferSelect,
  environment = getEnvironment(),
): ExternalPostgresConfig {
  return {
    host: source.host,
    port: source.port,
    database: source.databaseName,
    user: source.username,
    password: decryptCredential(
      source.encryptedPassword,
      environment.CREDENTIAL_ENCRYPTION_KEY,
    ),
  };
}
