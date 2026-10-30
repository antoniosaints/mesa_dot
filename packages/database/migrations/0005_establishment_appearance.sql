ALTER TABLE establishments ADD COLUMN primary_color VARCHAR(7) NOT NULL DEFAULT '#2584f8', ADD CONSTRAINT chk_establishment_primary_color CHECK (REGEXP_LIKE(primary_color, '^#[0-9a-fA-F]{6}$', 'c'));
