CREATE TABLE query_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  source_updated_at timestamptz NOT NULL,
  source_target_hash varchar(64) NOT NULL,
  draft_fingerprint varchar(64) NOT NULL,
  mode varchar(8) NOT NULL CHECK (mode IN ('create', 'update')),
  query_id uuid REFERENCES saved_queries(id) ON DELETE CASCADE,
  query_updated_at timestamptz,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (mode = 'create' AND query_id IS NULL AND query_updated_at IS NULL)
    OR (mode = 'update' AND query_id IS NOT NULL AND query_updated_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS query_test_runs_expires_at_idx
  ON query_test_runs(expires_at);
