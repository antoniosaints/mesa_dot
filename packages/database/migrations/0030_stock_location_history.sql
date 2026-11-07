ALTER TABLE stock_movements
  ADD COLUMN location_id CHAR(36) NULL,
  ADD CONSTRAINT fk_stock_movement_location FOREIGN KEY (tenant_id,establishment_id,location_id)
    REFERENCES stock_locations(tenant_id,establishment_id,id);
UPDATE stock_movements m
  JOIN stock_balances b ON b.tenant_id=m.tenant_id AND b.establishment_id=m.establishment_id AND b.id=m.balance_id
  SET m.location_id=b.location_id WHERE m.location_id IS NULL;
ALTER TABLE stock_replenishment_items
  ADD COLUMN location_id CHAR(36) NULL,
  ADD CONSTRAINT fk_replenishment_item_location FOREIGN KEY (tenant_id,establishment_id,location_id)
    REFERENCES stock_locations(tenant_id,establishment_id,id);
UPDATE stock_replenishment_items i
  JOIN stock_balances b ON b.tenant_id=i.tenant_id AND b.establishment_id=i.establishment_id AND b.id=i.balance_id
  SET i.location_id=b.location_id WHERE i.location_id IS NULL;
