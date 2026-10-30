ALTER TABLE tenant_memberships ADD COLUMN is_account_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- The provision audit identifies the original account owner, independently of role names.
UPDATE tenant_memberships tm
JOIN audit_logs a ON a.tenant_id=tm.tenant_id AND a.actor_id=tm.user_id
SET tm.is_account_admin=TRUE
WHERE a.action='tenant.provisioned' AND a.aggregate_id=tm.tenant_id;

CREATE INDEX idx_finance_entries_date ON financial_entries(tenant_id,establishment_id,created_at);
CREATE INDEX idx_finance_payments_date ON payments(tenant_id,establishment_id,confirmed_at);
CREATE INDEX idx_finance_refunds_date ON refunds(tenant_id,establishment_id,created_at);
CREATE INDEX idx_finance_cash_date ON cash_movements(tenant_id,establishment_id,created_at);
