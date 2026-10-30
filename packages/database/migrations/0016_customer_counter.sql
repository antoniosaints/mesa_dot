ALTER TABLE visitor_sessions
  MODIFY COLUMN table_id CHAR(36) NULL,
  ADD COLUMN service_mode ENUM('TABLE','COUNTER') NOT NULL DEFAULT 'TABLE',
  ADD CONSTRAINT ck_visitor_attendance CHECK ((service_mode='TABLE' AND table_id IS NOT NULL) OR (service_mode='COUNTER' AND table_id IS NULL AND session_id IS NULL));
ALTER TABLE orders
  DROP CHECK ck_orders_service_mode,
  ADD CONSTRAINT ck_orders_service_mode CHECK ((service_mode='TABLE' AND table_id IS NOT NULL AND payment_policy_snapshot<>'IMMEDIATE') OR (service_mode='COUNTER' AND table_id IS NULL AND ((source='POS' AND payment_policy_snapshot='IMMEDIATE') OR (source='CUSTOMER' AND payment_policy_snapshot='PREPAID' AND customer_id IS NOT NULL))));
