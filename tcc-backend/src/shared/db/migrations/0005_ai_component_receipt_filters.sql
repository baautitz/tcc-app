ALTER TABLE ai_component_receipts
  ADD COLUMN dashboard_id uuid,
  ADD COLUMN parameter_bindings jsonb,
  ADD COLUMN context_values jsonb,
  ADD COLUMN parameter_values jsonb;
