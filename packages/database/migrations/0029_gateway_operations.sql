CREATE TABLE gateway_operations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  kind ENUM('CHECKOUT','REFUND','TOKEN_REFRESH') NOT NULL,
  source_id CHAR(36) NOT NULL,
  operation_key CHAR(64) NOT NULL,
  requested_by CHAR(36) NOT NULL,
  payload JSON NOT NULL,
  response_json JSON NULL,
  state ENUM('PENDING','PROCESSING','COMPLETED','REVIEW') NOT NULL DEFAULT 'PENDING',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  lease_token CHAR(36) NULL,
  lease_until DATETIME(3) NULL,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_error VARCHAR(100) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_gateway_operation (tenant_id,establishment_id,kind,operation_key),
  UNIQUE KEY uq_gateway_operation_scope (tenant_id,establishment_id,id),
  KEY ix_gateway_operation_dispatch (state,next_attempt_at,lease_until),
  KEY ix_gateway_operation_source (tenant_id,establishment_id,kind,source_id,state),
  CONSTRAINT fk_gateway_operation_unit FOREIGN KEY (tenant_id,establishment_id) REFERENCES establishments(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payment_reconciliation (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  intent_id CHAR(36) NOT NULL,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  watch_until DATETIME(3) NOT NULL,
  lease_token CHAR(36) NULL,
  lease_until DATETIME(3) NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_checked_at DATETIME(3) NULL,
  last_error VARCHAR(100) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_reconciliation_intent (tenant_id,establishment_id,intent_id),
  UNIQUE KEY uq_reconciliation_scope (tenant_id,establishment_id,id),
  KEY ix_reconciliation_dispatch (next_attempt_at,watch_until,lease_until),
  CONSTRAINT fk_reconciliation_intent FOREIGN KEY (tenant_id,establishment_id,intent_id) REFERENCES payment_intents(tenant_id,establishment_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO payment_reconciliation(id,tenant_id,establishment_id,intent_id,watch_until)
SELECT UUID(),tenant_id,establishment_id,id,DATE_ADD(created_at,INTERVAL 180 DAY)
FROM payment_intents WHERE provider='mercadopago' AND created_at>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 180 DAY);
