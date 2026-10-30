ALTER TABLE products ADD COLUMN photo_revision CHAR(64) NULL;

CREATE TABLE product_photos (
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  revision CHAR(64) NOT NULL,
  png MEDIUMBLOB NOT NULL,
  thumbnail MEDIUMBLOB NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, establishment_id, product_id),
  FOREIGN KEY (tenant_id, establishment_id, product_id) REFERENCES products(tenant_id, establishment_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
