ALTER TABLE data_sources
  ADD COLUMN context_version integer NOT NULL DEFAULT 1;

ALTER TABLE data_source_tables
  ADD COLUMN context_version integer NOT NULL DEFAULT 1;

CREATE TABLE ai_context_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type varchar(8) NOT NULL CHECK (target_type IN ('source', 'table')),
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  table_id uuid REFERENCES data_source_tables(id) ON DELETE CASCADE,
  source_name varchar(160) NOT NULL,
  schema_name varchar(255),
  table_name varchar(255),
  base_context_version integer NOT NULL,
  current_context text NOT NULL,
  proposed_context text NOT NULL,
  reason text NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'dismissed', 'stale', 'expired')),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (target_type = 'source' AND table_id IS NULL AND schema_name IS NULL AND table_name IS NULL)
    OR (target_type = 'table' AND table_id IS NOT NULL AND schema_name IS NOT NULL AND table_name IS NOT NULL)
  )
);

CREATE INDEX ai_context_proposals_actor_status_idx
  ON ai_context_proposals(actor_id, status, expires_at);
