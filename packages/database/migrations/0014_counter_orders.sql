ALTER TABLE tabs
  MODIFY COLUMN session_id CHAR(36) NULL,
  MODIFY COLUMN mode ENUM('SHARED','INDIVIDUAL','COUNTER') NOT NULL,
  ADD CONSTRAINT ck_tabs_attendance CHECK ((mode='COUNTER' AND session_id IS NULL) OR (mode<>'COUNTER' AND session_id IS NOT NULL));
ALTER TABLE orders
  MODIFY COLUMN table_id CHAR(36) NULL,
  MODIFY COLUMN payment_policy_snapshot ENUM('PREPAID','POSTPAID','IMMEDIATE') NOT NULL,
  ADD COLUMN service_mode ENUM('TABLE','COUNTER') NOT NULL DEFAULT 'TABLE',
  ADD COLUMN customer_name VARCHAR(80) NULL,
  ADD CONSTRAINT ck_orders_service_mode CHECK ((service_mode='TABLE' AND table_id IS NOT NULL AND payment_policy_snapshot<>'IMMEDIATE') OR (service_mode='COUNTER' AND table_id IS NULL AND source='POS' AND payment_policy_snapshot='IMMEDIATE'));
