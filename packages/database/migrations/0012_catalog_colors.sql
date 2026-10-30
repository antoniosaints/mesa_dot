ALTER TABLE categories ADD COLUMN color CHAR(7) NULL,
  ADD CONSTRAINT ck_categories_color CHECK (color IS NULL OR REGEXP_LIKE(color, '^#[0-9a-fA-F]{6}$', 'c'));
ALTER TABLE stock_locations ADD COLUMN color CHAR(7) NULL,
  ADD CONSTRAINT ck_stock_locations_color CHECK (color IS NULL OR REGEXP_LIKE(color, '^#[0-9a-fA-F]{6}$', 'c'));
