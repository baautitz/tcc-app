CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  email varchar(320) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(255) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  description text,
  system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipes (
  id varchar(160) PRIMARY KEY,
  name varchar(200) NOT NULL,
  description text,
  source_uri text NOT NULL,
  checksum varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL UNIQUE,
  host varchar(255) NOT NULL,
  port integer NOT NULL DEFAULT 5432,
  database_name varchar(255) NOT NULL,
  username varchar(255) NOT NULL,
  encrypted_password text NOT NULL,
  context text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS data_source_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  schema_name varchar(255) NOT NULL,
  table_name varchar(255) NOT NULL,
  context text NOT NULL DEFAULT '',
  discovered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data_source_id, schema_name, table_name)
);

CREATE TABLE IF NOT EXISTS dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(160) NOT NULL,
  description text,
  definition jsonb NOT NULL DEFAULT '{"layout":{"columns":12,"gap":16},"components":[]}'::jsonb,
  recipe_id varchar(160),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS recipe_id varchar(160);

CREATE TABLE IF NOT EXISTS saved_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES data_sources(id),
  name varchar(160) NOT NULL,
  sql_text text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_permission_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  recipe_id varchar(160),
  recipe_key varchar(255),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE saved_queries ADD COLUMN IF NOT EXISTS recipe_id varchar(160);
ALTER TABLE saved_queries ADD COLUMN IF NOT EXISTS recipe_key varchar(255);
