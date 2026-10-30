ALTER TABLE orders
  ADD COLUMN cash_session_id CHAR(36) NULL,
  ADD CONSTRAINT fk_orders_cash_session FOREIGN KEY (tenant_id, establishment_id, cash_session_id)
    REFERENCES cash_sessions (tenant_id, establishment_id, id);
ALTER TABLE establishments
  ADD COLUMN order_cash_session_id CHAR(36) NULL,
  ADD CONSTRAINT fk_est_order_cash_session FOREIGN KEY (tenant_id, id, order_cash_session_id)
    REFERENCES cash_sessions (tenant_id, establishment_id, id);
