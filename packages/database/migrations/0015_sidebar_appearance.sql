ALTER TABLE establishments
  ADD COLUMN sidebar_color VARCHAR(7) NOT NULL DEFAULT '#0d1b2a',
  ADD CONSTRAINT chk_establishment_sidebar_color CHECK (REGEXP_LIKE(sidebar_color, '^#[0-9a-fA-F]{6}$', 'c'));
