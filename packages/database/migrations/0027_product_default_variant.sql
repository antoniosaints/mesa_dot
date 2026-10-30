ALTER TABLE products
  ADD COLUMN default_variant_name VARCHAR(100) NOT NULL DEFAULT 'Padrão',
  ADD CONSTRAINT chk_product_default_variant_name CHECK (CHAR_LENGTH(TRIM(default_variant_name)) > 0);

ALTER TABLE product_variants ADD COLUMN deleted_at DATETIME(3) NULL;
