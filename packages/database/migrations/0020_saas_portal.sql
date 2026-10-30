ALTER TABLE tenants ADD COLUMN is_platform BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE public_registrations (
  key_hash CHAR(64) PRIMARY KEY,
  request_hash CHAR(64) NOT NULL,
  tenant_id CHAR(36) NULL,
  establishment_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (establishment_id) REFERENCES establishments(id)
);
