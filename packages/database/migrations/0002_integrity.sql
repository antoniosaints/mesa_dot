-- One default stock location per venue, using MySQL NULL uniqueness semantics.
ALTER TABLE stock_locations ADD COLUMN default_slot TINYINT GENERATED ALWAYS AS (CASE WHEN is_default THEN 1 ELSE NULL END) STORED, ADD UNIQUE KEY uq_stock_default (tenant_id, establishment_id, default_slot);
ALTER TABLE staff_memberships ADD CONSTRAINT fk_staff_tenant_membership FOREIGN KEY (tenant_id,user_id) REFERENCES tenant_memberships(tenant_id,user_id);
CREATE TABLE saas_audit_logs (
 id CHAR(36) NOT NULL PRIMARY KEY,
 actor_id CHAR(36) NOT NULL,
 action VARCHAR(100) NOT NULL,
 aggregate_id CHAR(36) NOT NULL,
 metadata JSON NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
