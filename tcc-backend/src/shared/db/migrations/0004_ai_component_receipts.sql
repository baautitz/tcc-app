CREATE TABLE ai_component_receipts (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  component jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_component_receipts_expires_at_idx
  ON ai_component_receipts(expires_at);
