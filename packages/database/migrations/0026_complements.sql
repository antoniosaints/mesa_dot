CREATE TABLE unit_complements (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  provider ENUM('mercadopago','gemini') NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  credentials TEXT NULL,
  settings JSON NULL,
  external_account_id VARCHAR(80) NULL,
  connected_at DATETIME(3) NULL,
  last_checked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_unit_complement (tenant_id,establishment_id,provider),
  UNIQUE KEY uq_unit_complement_scope (tenant_id,establishment_id,id),
  CONSTRAINT fk_unit_complement_unit FOREIGN KEY (tenant_id,establishment_id) REFERENCES establishments(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE complement_oauth_states (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  initiated_by CHAR(36) NOT NULL,
  state_hash CHAR(64) NOT NULL UNIQUE,
  verifier TEXT NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_complement_oauth_scope (tenant_id,establishment_id,id),
  KEY ix_complement_oauth_expiry (expires_at),
  CONSTRAINT fk_complement_oauth_unit FOREIGN KEY (tenant_id,establishment_id) REFERENCES establishments(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE payment_intents ADD COLUMN checkout_url VARCHAR(2048) NULL, ADD COLUMN external_account_id VARCHAR(80) NULL;
