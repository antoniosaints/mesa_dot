CREATE TABLE IF NOT EXISTS tenant_slugs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  slug VARCHAR(80) NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  retired_at DATETIME(3) NULL,
  current_establishment_id CHAR(36) GENERATED ALWAYS AS (CASE WHEN is_current THEN establishment_id ELSE NULL END) STORED,
  UNIQUE KEY uq_public_slug (slug),
  UNIQUE KEY uq_current_establishment_slug (current_establishment_id),
  KEY idx_tenant_slug_unit (tenant_id, establishment_id, is_current),
  FOREIGN KEY (tenant_id,establishment_id) REFERENCES establishments(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS establishment_pwa_settings (
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  short_name VARCHAR(32) NULL,
  background_color CHAR(7) NOT NULL DEFAULT '#ffffff',
  icon_revision CHAR(64) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,establishment_id),
  FOREIGN KEY (tenant_id,establishment_id) REFERENCES establishments(tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS pwa_icons (
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  revision CHAR(64) NOT NULL,
  size SMALLINT UNSIGNED NOT NULL,
  png MEDIUMBLOB NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id,establishment_id,revision,size),
  FOREIGN KEY (tenant_id,establishment_id) REFERENCES establishments(tenant_id,id),
  CHECK (size IN (32,180,192,512))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
