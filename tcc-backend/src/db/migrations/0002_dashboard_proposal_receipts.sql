CREATE TABLE dashboard_proposal_receipts (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode varchar(8) NOT NULL CHECK (mode IN ('create', 'update')),
  dashboard_id uuid NOT NULL,
  expected_dashboard_fingerprint varchar(64),
  document jsonb NOT NULL,
  document_fingerprint varchar(64) NOT NULL,
  reference_fingerprint varchar(64) NOT NULL,
  has_truncated_preview boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (mode = 'create' AND expected_dashboard_fingerprint IS NULL)
    OR (mode = 'update' AND expected_dashboard_fingerprint IS NOT NULL)
  )
);

CREATE INDEX dashboard_proposal_receipts_expires_at_idx
  ON dashboard_proposal_receipts(expires_at);
