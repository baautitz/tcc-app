import { sql } from "drizzle-orm";
import {
  boolean,
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

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt,
  updatedAt,
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 255 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  system: boolean("system").notNull().default(false),
  createdAt,
}, (table) => [uniqueIndex("permissions_key_unique").on(table.key)]);

export const dashboards = pgTable("dashboards", {
  dashboardId: uuid("dashboard_id").primaryKey(),
  filePath: text("file_path").notNull(),
}, (table) => [uniqueIndex("dashboards_file_path_unique").on(table.filePath)]);

export const userPermissions = pgTable("user_permissions", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  createdAt,
}, (table) => [primaryKey({ columns: [table.userId, table.permissionId] })]);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt,
});

export const dataSources = pgTable("data_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 160 }).notNull(),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(5432),
  databaseName: varchar("database_name", { length: 255 }).notNull(),
  username: varchar("username", { length: 255 }).notNull(),
  encryptedPassword: text("encrypted_password").notNull(),
  context: text("context").notNull().default(""),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt,
  updatedAt,
}, (table) => [uniqueIndex("data_sources_name_unique").on(table.name)]);

export const dataSourceTables = pgTable("data_source_tables", {
  id: uuid("id").primaryKey().defaultRandom(),
  dataSourceId: uuid("data_source_id").notNull().references(() => dataSources.id, { onDelete: "cascade" }),
  schemaName: varchar("schema_name", { length: 255 }).notNull(),
  tableName: varchar("table_name", { length: 255 }).notNull(),
  context: text("context").notNull().default(""),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("data_source_tables_unique").on(table.dataSourceId, table.schemaName, table.tableName)]);

export const savedQueries = pgTable("saved_queries", {
  id: uuid("id").primaryKey().defaultRandom(),
  dataSourceId: uuid("data_source_id").notNull().references(() => dataSources.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  sqlText: text("sql_text").notNull(),
  parameters: jsonb("parameters").notNull().default(sql`'[]'::jsonb`),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt,
  updatedAt,
});

export const dashboardUsers = pgTable("dashboard_users", {
  dashboardId: uuid("dashboard_id").notNull().references(() => dashboards.dashboardId, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt,
}, (table) => [primaryKey({ columns: [table.dashboardId, table.userId] })]);
