ALTER TABLE dining_tables
  ADD COLUMN deleted_at DATETIME(3) NULL,
  ADD COLUMN active_number VARCHAR(16) GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN number ELSE NULL END) STORED,
  DROP INDEX tenant_id,
  ADD UNIQUE KEY uq_dining_tables_active_number (tenant_id, establishment_id, active_number);
