import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 160 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    active: boolean("active").notNull().default(true),
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: varchar("key", { length: 255 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    system: boolean("system").notNull().default(false),
    createdAt,
  },
  (table) => [uniqueIndex("permissions_key_unique").on(table.key)],
);

export const dashboards = pgTable(
  "dashboards",
  {
    dashboardId: uuid("dashboard_id").primaryKey(),
    filePath: text("file_path").notNull(),
  },
  (table) => [uniqueIndex("dashboards_file_path_unique").on(table.filePath)],
);

export const userPermissions = pgTable(
  "user_permissions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [primaryKey({ columns: [table.userId, table.permissionId] })],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt,
});

export const dataSources = pgTable(
  "data_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 160 }).notNull(),
    host: varchar("host", { length: 255 }).notNull(),
    port: integer("port").notNull().default(5432),
    databaseName: varchar("database_name", { length: 255 }).notNull(),
    username: varchar("username", { length: 255 }).notNull(),
    encryptedPassword: text("encrypted_password").notNull(),
    context: text("context").notNull().default(""),
    contextVersion: integer("context_version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("data_sources_name_unique").on(table.name)],
);

export const dataSourceTables = pgTable(
  "data_source_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    schemaName: varchar("schema_name", { length: 255 }).notNull(),
    tableName: varchar("table_name", { length: 255 }).notNull(),
    context: text("context").notNull().default(""),
    contextVersion: integer("context_version").notNull().default(1),
    discoveredAt: timestamp("discovered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("data_source_tables_unique").on(
      table.dataSourceId,
      table.schemaName,
      table.tableName,
    ),
  ],
);

export const savedQueries = pgTable("saved_queries", {
  id: uuid("id").primaryKey().defaultRandom(),
  dataSourceId: uuid("data_source_id")
    .notNull()
    .references(() => dataSources.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  sqlText: text("sql_text").notNull(),
  parameters: jsonb("parameters")
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt,
  updatedAt,
});

export const queryTestRuns = pgTable(
  "query_test_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    sourceUpdatedAt: timestamp("source_updated_at", {
      withTimezone: true,
    }).notNull(),
    sourceTargetHash: varchar("source_target_hash", { length: 64 }).notNull(),
    draftFingerprint: varchar("draft_fingerprint", { length: 64 }).notNull(),
    mode: varchar("mode", { length: 8 }).notNull(),
    queryId: uuid("query_id").references(() => savedQueries.id, {
      onDelete: "cascade",
    }),
    queryUpdatedAt: timestamp("query_updated_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    check(
      "query_test_runs_mode_check",
      sql`${table.mode} IN ('create', 'update')`,
    ),
    check(
      "query_test_runs_target_check",
      sql`(${table.mode} = 'create' AND ${table.queryId} IS NULL AND ${table.queryUpdatedAt} IS NULL) OR (${table.mode} = 'update' AND ${table.queryId} IS NOT NULL AND ${table.queryUpdatedAt} IS NOT NULL)`,
    ),
    index("query_test_runs_expires_at_idx").on(table.expiresAt),
  ],
);

export const dashboardProposalReceipts = pgTable(
  "dashboard_proposal_receipts",
  {
    id: uuid("id").primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mode: varchar("mode", { length: 8 }).notNull(),
    dashboardId: uuid("dashboard_id").notNull(),
    expectedDashboardFingerprint: varchar("expected_dashboard_fingerprint", {
      length: 64,
    }),
    document: jsonb("document").notNull(),
    documentFingerprint: varchar("document_fingerprint", {
      length: 64,
    }).notNull(),
    referenceFingerprint: varchar("reference_fingerprint", {
      length: 64,
    }).notNull(),
    hasTruncatedPreview: boolean("has_truncated_preview")
      .notNull()
      .default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    check(
      "dashboard_proposal_receipts_mode_check",
      sql`${table.mode} IN ('create', 'update')`,
    ),
    check(
      "dashboard_proposal_receipts_target_check",
      sql`(${table.mode} = 'create' AND ${table.expectedDashboardFingerprint} IS NULL) OR (${table.mode} = 'update' AND ${table.expectedDashboardFingerprint} IS NOT NULL)`,
    ),
    index("dashboard_proposal_receipts_expires_at_idx").on(table.expiresAt),
  ],
);

export const aiComponentReceipts = pgTable(
  "ai_component_receipts",
  {
    id: uuid("id").primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    component: jsonb("component").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    index("ai_component_receipts_expires_at_idx").on(table.expiresAt),
  ],
);

export const aiContextProposals = pgTable(
  "ai_context_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 8 }).notNull(),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    tableId: uuid("table_id").references(() => dataSourceTables.id, {
      onDelete: "cascade",
    }),
    sourceName: varchar("source_name", { length: 160 }).notNull(),
    schemaName: varchar("schema_name", { length: 255 }),
    tableName: varchar("table_name", { length: 255 }),
    baseContextVersion: integer("base_context_version").notNull(),
    currentContext: text("current_context").notNull(),
    proposedContext: text("proposed_context").notNull(),
    reason: text("reason").notNull(),
    status: varchar("status", { length: 10 }).notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    check(
      "ai_context_proposals_target_type_check",
      sql`${table.targetType} IN ('source', 'table')`,
    ),
    check(
      "ai_context_proposals_status_check",
      sql`${table.status} IN ('pending', 'approved', 'dismissed', 'stale', 'expired')`,
    ),
    check(
      "ai_context_proposals_target_check",
      sql`(${table.targetType} = 'source' AND ${table.tableId} IS NULL AND ${table.schemaName} IS NULL AND ${table.tableName} IS NULL) OR (${table.targetType} = 'table' AND ${table.tableId} IS NOT NULL AND ${table.schemaName} IS NOT NULL AND ${table.tableName} IS NOT NULL)`,
    ),
    index("ai_context_proposals_actor_status_idx").on(
      table.actorId,
      table.status,
      table.expiresAt,
    ),
  ],
);

export const dashboardUsers = pgTable(
  "dashboard_users",
  {
    dashboardId: uuid("dashboard_id")
      .notNull()
      .references(() => dashboards.dashboardId, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [primaryKey({ columns: [table.dashboardId, table.userId] })],
);
