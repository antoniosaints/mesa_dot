-- MySQL 8.4 / InnoDB. DDL is not transactionally reversible. See docs/operations.md.
CREATE TABLE `tenants` (
  id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `plans` (
  id CHAR(36) NOT NULL,
  name VARCHAR(80) NOT NULL,
  monthly_price DECIMAL(14,2) NOT NULL,
  limits_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `subscriptions` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  plan_id CHAR(36) NOT NULL,
  status VARCHAR(30) NOT NULL,
  valid_until DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `establishments` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  payment_mode ENUM('MIXED','PREPAID_ONLY','POSTPAID_ONLY') NOT NULL DEFAULT 'MIXED',
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  postpaid_limit DECIMAL(14,2) NOT NULL DEFAULT 1000.00,
  visitor_ttl_minutes INT NOT NULL DEFAULT 120,
  retention_days INT NOT NULL DEFAULT 90,
  opening_hours JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_est_scope (tenant_id,id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CHECK (postpaid_limit >= 0),
  CHECK (visitor_ttl_minutes BETWEEN 10 AND 1440)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `users` (
  id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_superadmin BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tenant_memberships` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (tenant_id,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `roles` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  name VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_roles_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  UNIQUE (tenant_id,establishment_id,name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `permissions` (
  id CHAR(36) NOT NULL,
  code VARCHAR(80) NOT NULL UNIQUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `role_permissions` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  role_id CHAR(36) NOT NULL,
  permission_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_role_permissions_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_role_permissions_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_role_permissions_role_id FOREIGN KEY (tenant_id, establishment_id, role_id) REFERENCES roles (tenant_id, establishment_id, id),
  FOREIGN KEY (permission_id) REFERENCES permissions(id),
  UNIQUE (tenant_id,establishment_id,role_id,permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `staff_memberships` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role_id CHAR(36) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_memberships_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_staff_memberships_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_staff_memberships_role_id FOREIGN KEY (tenant_id, establishment_id, role_id) REFERENCES roles (tenant_id, establishment_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (tenant_id,establishment_id,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `staff_sessions` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  refresh_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME(3) NOT NULL,
  refresh_expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_sessions_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_staff_sessions_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `areas` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_areas_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_areas_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `dining_tables` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  area_id CHAR(36) NULL,
  number VARCHAR(16) NOT NULL,
  public_code VARCHAR(64) NOT NULL UNIQUE,
  capacity INT NOT NULL DEFAULT 4,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  position_x INT NOT NULL DEFAULT 0,
  position_y INT NOT NULL DEFAULT 0,
  shape VARCHAR(16) NOT NULL DEFAULT 'square',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_dining_tables_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_dining_tables_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_dining_tables_area_id FOREIGN KEY (tenant_id, establishment_id, area_id) REFERENCES areas (tenant_id, establishment_id, id),
  UNIQUE (tenant_id,establishment_id,number),
  CHECK (capacity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `floor_layouts` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  layout_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_floor_layouts_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_floor_layouts_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `table_sessions` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  table_id CHAR(36) NOT NULL,
  status ENUM('OPEN','CLOSING','AWAITING_RELEASE','CLOSED') NOT NULL DEFAULT 'OPEN',
  opened_at DATETIME(3) NOT NULL,
  closed_at DATETIME(3) NULL,
  opened_by CHAR(36) NULL,
  closed_by CHAR(36) NULL,
  join_nonce CHAR(64) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  active_table_id CHAR(36) GENERATED ALWAYS AS (CASE WHEN status <> 'CLOSED' THEN table_id ELSE NULL END) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_table_sessions_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_table_sessions_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_table_sessions_table_id FOREIGN KEY (tenant_id, establishment_id, table_id) REFERENCES dining_tables (tenant_id, establishment_id, id),
  UNIQUE KEY uq_table_active_session (tenant_id,establishment_id,active_table_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `customers` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  anonymized_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_customers_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `visitor_sessions` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  table_id CHAR(36) NOT NULL,
  session_id CHAR(36) NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_visitor_sessions_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_visitor_sessions_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_visitor_sessions_customer_id FOREIGN KEY (tenant_id, establishment_id, customer_id) REFERENCES customers (tenant_id, establishment_id, id),
  CONSTRAINT fk_visitor_sessions_table_id FOREIGN KEY (tenant_id, establishment_id, table_id) REFERENCES dining_tables (tenant_id, establishment_id, id),
  CONSTRAINT fk_visitor_sessions_session_id FOREIGN KEY (tenant_id, establishment_id, session_id) REFERENCES table_sessions (tenant_id, establishment_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `table_participants` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_table_participants_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_table_participants_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_table_participants_session_id FOREIGN KEY (tenant_id, establishment_id, session_id) REFERENCES table_sessions (tenant_id, establishment_id, id),
  CONSTRAINT fk_table_participants_customer_id FOREIGN KEY (tenant_id, establishment_id, customer_id) REFERENCES customers (tenant_id, establishment_id, id),
  UNIQUE (tenant_id,establishment_id,session_id,customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tabs` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  mode ENUM('SHARED','INDIVIDUAL') NOT NULL,
  status ENUM('OPEN','CLOSING','CLOSED') NOT NULL DEFAULT 'OPEN',
  label VARCHAR(100) NOT NULL,
  owner_customer_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tabs_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_tabs_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_tabs_session_id FOREIGN KEY (tenant_id, establishment_id, session_id) REFERENCES table_sessions (tenant_id, establishment_id, id),
  CONSTRAINT fk_tabs_owner_customer_id FOREIGN KEY (tenant_id, establishment_id, owner_customer_id) REFERENCES customers (tenant_id, establishment_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tab_customers` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  tab_id CHAR(36) NOT NULL,
  customer_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tab_customers_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_tab_customers_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_tab_customers_tab_id FOREIGN KEY (tenant_id, establishment_id, tab_id) REFERENCES tabs (tenant_id, establishment_id, id),
  CONSTRAINT fk_tab_customers_customer_id FOREIGN KEY (tenant_id, establishment_id, customer_id) REFERENCES customers (tenant_id, establishment_id, id),
  UNIQUE (tenant_id,establishment_id,tab_id,customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `categories` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_categories_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `products` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  category_id CHAR(36) NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  price DECIMAL(14,2) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  stock_policy ENUM('ON_CONFIRMATION','ON_DELIVERY','ON_PRODUCTION','RECIPE','NO_CONTROL') NOT NULL DEFAULT 'NO_CONTROL',
  requires_production BOOLEAN NOT NULL DEFAULT FALSE,
  sector VARCHAR(40) NOT NULL DEFAULT 'bar',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_products_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_products_category_id FOREIGN KEY (tenant_id, establishment_id, category_id) REFERENCES categories (tenant_id, establishment_id, id),
  CHECK (price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `product_categories` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  category_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_categories_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_product_categories_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_product_categories_product_id FOREIGN KEY (tenant_id, establishment_id, product_id) REFERENCES products (tenant_id, establishment_id, id),
  CONSTRAINT fk_product_categories_category_id FOREIGN KEY (tenant_id, establishment_id, category_id) REFERENCES categories (tenant_id, establishment_id, id),
  UNIQUE (tenant_id,establishment_id,product_id,category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `product_variants` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(14,2) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_variants_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_product_variants_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_product_variants_product_id FOREIGN KEY (tenant_id, establishment_id, product_id) REFERENCES products (tenant_id, establishment_id, id),
  CHECK(price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `modifier_groups` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  min_choices INT NOT NULL DEFAULT 0,
  max_choices INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_modifier_groups_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_modifier_groups_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CHECK (min_choices >= 0 AND max_choices >= min_choices)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `modifiers` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  group_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(14,2) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_modifiers_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_modifiers_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_modifiers_group_id FOREIGN KEY (tenant_id, establishment_id, group_id) REFERENCES modifier_groups (tenant_id, establishment_id, id),
  CHECK(price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `product_modifiers` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  group_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_modifiers_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_product_modifiers_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_product_modifiers_product_id FOREIGN KEY (tenant_id, establishment_id, product_id) REFERENCES products (tenant_id, establishment_id, id),
  CONSTRAINT fk_product_modifiers_group_id FOREIGN KEY (tenant_id, establishment_id, group_id) REFERENCES modifier_groups (tenant_id, establishment_id, id),
  UNIQUE (tenant_id,establishment_id,product_id,group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `availability_rules` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  weekday INT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_availability_rules_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_availability_rules_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_availability_rules_product_id FOREIGN KEY (tenant_id, establishment_id, product_id) REFERENCES products (tenant_id, establishment_id, id),
  CHECK (weekday BETWEEN 0 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `orders` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  table_id CHAR(36) NOT NULL,
  tab_id CHAR(36) NULL,
  customer_id CHAR(36) NULL,
  source ENUM('CUSTOMER','WAITER','POS') NOT NULL,
  status ENUM('DRAFT','PENDING_PAYMENT','CONFIRMED','CANCELLED') NOT NULL,
  payment_policy_snapshot ENUM('PREPAID','POSTPAID') NOT NULL,
  total DECIMAL(14,2) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  created_by CHAR(36) NOT NULL,
  confirmed_at DATETIME(3) NULL,
  checkout_expires_at DATETIME(3) NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_orders_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_orders_table_id FOREIGN KEY (tenant_id, establishment_id, table_id) REFERENCES dining_tables (tenant_id, establishment_id, id),
  CONSTRAINT fk_orders_tab_id FOREIGN KEY (tenant_id, establishment_id, tab_id) REFERENCES tabs (tenant_id, establishment_id, id),
  CONSTRAINT fk_orders_customer_id FOREIGN KEY (tenant_id, establishment_id, customer_id) REFERENCES customers (tenant_id, establishment_id, id),
  CHECK(total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `order_items` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  variant_id CHAR(36) NULL,
  quantity INT NOT NULL,
  name_snapshot VARCHAR(160) NOT NULL,
  unit_price DECIMAL(14,2) NOT NULL,
  total DECIMAL(14,2) NOT NULL,
  stock_policy_snapshot VARCHAR(30) NOT NULL,
  stock_components JSON NOT NULL,
  requires_production BOOLEAN NOT NULL,
  notes VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_items_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_order_items_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_order_items_order_id FOREIGN KEY (tenant_id, establishment_id, order_id) REFERENCES orders (tenant_id, establishment_id, id),
  CONSTRAINT fk_order_items_product_id FOREIGN KEY (tenant_id, establishment_id, product_id) REFERENCES products (tenant_id, establishment_id, id),
  CONSTRAINT fk_order_items_variant_id FOREIGN KEY (tenant_id, establishment_id, variant_id) REFERENCES product_variants (tenant_id, establishment_id, id),
  CHECK(quantity BETWEEN 1 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `order_item_modifiers` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  order_item_id CHAR(36) NOT NULL,
  modifier_id CHAR(36) NOT NULL,
  name_snapshot VARCHAR(100) NOT NULL,
  price DECIMAL(14,2) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_item_modifiers_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_order_item_modifiers_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_order_item_modifiers_order_item_id FOREIGN KEY (tenant_id, establishment_id, order_item_id) REFERENCES order_items (tenant_id, establishment_id, id),
  CONSTRAINT fk_order_item_modifiers_modifier_id FOREIGN KEY (tenant_id, establishment_id, modifier_id) REFERENCES modifiers (tenant_id, establishment_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `order_adjustments` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_adjustments_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_order_adjustments_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_order_adjustments_order_id FOREIGN KEY (tenant_id, establishment_id, order_id) REFERENCES orders (tenant_id, establishment_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `order_status_events` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  status VARCHAR(30) NOT NULL,
  actor_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_status_events_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_order_status_events_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_order_status_events_order_id FOREIGN KEY (tenant_id, establishment_id, order_id) REFERENCES orders (tenant_id, establishment_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `payment_intents` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  provider VARCHAR(30) NOT NULL DEFAULT 'sandbox',
  provider_reference VARCHAR(100) NOT NULL UNIQUE,
  amount DECIMAL(14,2) NOT NULL,
  status ENUM('PENDING','PROCESSING','APPROVED','FAILED') NOT NULL DEFAULT 'PENDING',
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_intents_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_payment_intents_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_payment_intents_order_id FOREIGN KEY (tenant_id, establishment_id, order_id) REFERENCES orders (tenant_id, establishment_id, id),
  CHECK(amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `payments` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  intent_id CHAR(36) NULL,
  provider VARCHAR(30) NOT NULL,
  provider_reference VARCHAR(100) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  status ENUM('PENDING','PROCESSING','APPROVED','FAILED','REFUNDED','PARTIALLY_REFUNDED') NOT NULL,
  confirmed_at DATETIME(3) NULL,
  settled_at DATETIME(3) NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  review_reason VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_payments_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_payments_intent_id FOREIGN KEY (tenant_id, establishment_id, intent_id) REFERENCES payment_intents (tenant_id, establishment_id, id),
  UNIQUE(provider,provider_reference),
  CHECK(amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `payment_webhooks` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  provider VARCHAR(30) NOT NULL,
  provider_event_id VARCHAR(128) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  payment_id CHAR(36) NULL,
  status VARCHAR(30) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_webhooks_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_payment_webhooks_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_payment_webhooks_payment_id FOREIGN KEY (tenant_id, establishment_id, payment_id) REFERENCES payments (tenant_id, establishment_id, id),
  UNIQUE(provider,provider_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `payment_allocations` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  payment_id CHAR(36) NOT NULL,
  tab_id CHAR(36) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_allocations_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_payment_allocations_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_payment_allocations_payment_id FOREIGN KEY (tenant_id, establishment_id, payment_id) REFERENCES payments (tenant_id, establishment_id, id),
  CONSTRAINT fk_payment_allocations_tab_id FOREIGN KEY (tenant_id, establishment_id, tab_id) REFERENCES tabs (tenant_id, establishment_id, id),
  CHECK(amount > 0),
  UNIQUE(tenant_id,establishment_id,payment_id,tab_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `refunds` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  payment_id CHAR(36) NOT NULL,
  tab_id CHAR(36) NULL,
  amount DECIMAL(14,2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_by CHAR(36) NOT NULL,
  provider_reference VARCHAR(128) NOT NULL,
  status VARCHAR(30) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_refunds_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_refunds_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_refunds_payment_id FOREIGN KEY (tenant_id, establishment_id, payment_id) REFERENCES payments (tenant_id, establishment_id, id),
  CONSTRAINT fk_refunds_tab_id FOREIGN KEY (tenant_id, establishment_id, tab_id) REFERENCES tabs (tenant_id, establishment_id, id),
  CHECK(amount > 0),
  UNIQUE(provider_reference)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `financial_entries` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  tab_id CHAR(36) NOT NULL,
  order_id CHAR(36) NULL,
  type ENUM('CHARGE','CREDIT','DISCOUNT') NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  source_key VARCHAR(150) NOT NULL,
  reason VARCHAR(255) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_financial_entries_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_financial_entries_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_financial_entries_tab_id FOREIGN KEY (tenant_id, establishment_id, tab_id) REFERENCES tabs (tenant_id, establishment_id, id),
  CONSTRAINT fk_financial_entries_order_id FOREIGN KEY (tenant_id, establishment_id, order_id) REFERENCES orders (tenant_id, establishment_id, id),
  UNIQUE(tenant_id,establishment_id,source_key),
  CHECK(amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cash_registers` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_cash_registers_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_cash_registers_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cash_sessions` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  register_id CHAR(36) NOT NULL,
  status ENUM('OPEN','CLOSED') NOT NULL,
  opening_amount DECIMAL(14,2) NOT NULL,
  counted_amount DECIMAL(14,2) NULL,
  opened_by CHAR(36) NOT NULL,
  closed_by CHAR(36) NULL,
  closed_at DATETIME(3) NULL,
  active_register_id CHAR(36) GENERATED ALWAYS AS (CASE WHEN status = 'OPEN' THEN register_id ELSE NULL END) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_cash_sessions_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_cash_sessions_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_cash_sessions_register_id FOREIGN KEY (tenant_id, establishment_id, register_id) REFERENCES cash_registers (tenant_id, establishment_id, id),
  UNIQUE(tenant_id,establishment_id,active_register_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cash_movements` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  cash_session_id CHAR(36) NOT NULL,
  payment_id CHAR(36) NULL,
  type VARCHAR(30) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  source_key VARCHAR(150) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_cash_movements_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_cash_movements_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_cash_movements_cash_session_id FOREIGN KEY (tenant_id, establishment_id, cash_session_id) REFERENCES cash_sessions (tenant_id, establishment_id, id),
  CONSTRAINT fk_cash_movements_payment_id FOREIGN KEY (tenant_id, establishment_id, payment_id) REFERENCES payments (tenant_id, establishment_id, id),
  UNIQUE(tenant_id,establishment_id,source_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `stock_locations` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stock_locations_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_stock_locations_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `stock_balances` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  location_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  physical_quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  reserved_quantity DECIMAL(14,3) NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stock_balances_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_stock_balances_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_stock_balances_location_id FOREIGN KEY (tenant_id, establishment_id, location_id) REFERENCES stock_locations (tenant_id, establishment_id, id),
  CONSTRAINT fk_stock_balances_product_id FOREIGN KEY (tenant_id, establishment_id, product_id) REFERENCES products (tenant_id, establishment_id, id),
  UNIQUE(tenant_id,establishment_id,location_id,product_id),
  CHECK(physical_quantity >= reserved_quantity AND reserved_quantity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `recipes` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  product_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_recipes_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_recipes_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_recipes_product_id FOREIGN KEY (tenant_id, establishment_id, product_id) REFERENCES products (tenant_id, establishment_id, id),
  UNIQUE(tenant_id,establishment_id,product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `recipe_items` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  recipe_id CHAR(36) NOT NULL,
  ingredient_id CHAR(36) NOT NULL,
  quantity DECIMAL(14,3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_recipe_items_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_recipe_items_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_recipe_items_recipe_id FOREIGN KEY (tenant_id, establishment_id, recipe_id) REFERENCES recipes (tenant_id, establishment_id, id),
  CONSTRAINT fk_recipe_items_ingredient_id FOREIGN KEY (tenant_id, establishment_id, ingredient_id) REFERENCES products (tenant_id, establishment_id, id),
  CHECK(quantity > 0),
  UNIQUE(tenant_id,establishment_id,recipe_id,ingredient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `checkout_holds` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  balance_id CHAR(36) NOT NULL,
  quantity DECIMAL(14,3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  status ENUM('HELD','CONSUMED','EXPIRED','RELEASED') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_checkout_holds_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_checkout_holds_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_checkout_holds_order_id FOREIGN KEY (tenant_id, establishment_id, order_id) REFERENCES orders (tenant_id, establishment_id, id),
  CONSTRAINT fk_checkout_holds_balance_id FOREIGN KEY (tenant_id, establishment_id, balance_id) REFERENCES stock_balances (tenant_id, establishment_id, id),
  UNIQUE(tenant_id,establishment_id,order_id,balance_id),
  CHECK(quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tickets` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  order_item_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_nonce CHAR(64) NOT NULL,
  public_number VARCHAR(20) NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  status ENUM('PENDING','PREPARING','AVAILABLE','REQUESTED','ASSIGNED','REDEEMED','CANCELLED') NOT NULL,
  redeemed_at DATETIME(3) NULL,
  redeemed_by CHAR(36) NULL,
  version INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tickets_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_tickets_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_tickets_order_item_id FOREIGN KEY (tenant_id, establishment_id, order_item_id) REFERENCES order_items (tenant_id, establishment_id, id),
  CHECK(qty = 1),
  UNIQUE(tenant_id,establishment_id,public_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `stock_reservations` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  ticket_id CHAR(36) NOT NULL,
  balance_id CHAR(36) NOT NULL,
  quantity DECIMAL(14,3) NOT NULL,
  status ENUM('RESERVED','CONSUMED','RELEASED') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stock_reservations_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_stock_reservations_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_stock_reservations_ticket_id FOREIGN KEY (tenant_id, establishment_id, ticket_id) REFERENCES tickets (tenant_id, establishment_id, id),
  CONSTRAINT fk_stock_reservations_balance_id FOREIGN KEY (tenant_id, establishment_id, balance_id) REFERENCES stock_balances (tenant_id, establishment_id, id),
  UNIQUE(tenant_id,establishment_id,ticket_id,balance_id),
  CHECK(quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `stock_movements` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  balance_id CHAR(36) NOT NULL,
  ticket_id CHAR(36) NULL,
  quantity DECIMAL(14,3) NOT NULL,
  type VARCHAR(30) NOT NULL,
  source_key VARCHAR(150) NOT NULL,
  created_by CHAR(36) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stock_movements_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_stock_movements_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_stock_movements_balance_id FOREIGN KEY (tenant_id, establishment_id, balance_id) REFERENCES stock_balances (tenant_id, establishment_id, id),
  CONSTRAINT fk_stock_movements_ticket_id FOREIGN KEY (tenant_id, establishment_id, ticket_id) REFERENCES tickets (tenant_id, establishment_id, id),
  UNIQUE(tenant_id,establishment_id,source_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `ticket_events` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  ticket_id CHAR(36) NOT NULL,
  event VARCHAR(40) NOT NULL,
  actor_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_events_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_ticket_events_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_ticket_events_ticket_id FOREIGN KEY (tenant_id, establishment_id, ticket_id) REFERENCES tickets (tenant_id, establishment_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `service_requests` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  ticket_id CHAR(36) NOT NULL,
  status ENUM('OPEN','CLAIMED','COMPLETED','CANCELLED') NOT NULL,
  claimed_by CHAR(36) NULL,
  completed_at DATETIME(3) NULL,
  active_ticket_id CHAR(36) GENERATED ALWAYS AS (CASE WHEN status IN ('OPEN','CLAIMED') THEN ticket_id ELSE NULL END) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_requests_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_service_requests_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_service_requests_ticket_id FOREIGN KEY (tenant_id, establishment_id, ticket_id) REFERENCES tickets (tenant_id, establishment_id, id),
  UNIQUE(tenant_id,establishment_id,active_ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `service_request_events` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  request_id CHAR(36) NOT NULL,
  event VARCHAR(40) NOT NULL,
  actor_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_request_events_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_service_request_events_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_service_request_events_request_id FOREIGN KEY (tenant_id, establishment_id, request_id) REFERENCES service_requests (tenant_id, establishment_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `production_jobs` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  ticket_id CHAR(36) NOT NULL,
  sector VARCHAR(40) NOT NULL,
  status ENUM('PENDING','PREPARING','READY','CANCELLED') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_production_jobs_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_production_jobs_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_production_jobs_ticket_id FOREIGN KEY (tenant_id, establishment_id, ticket_id) REFERENCES tickets (tenant_id, establishment_id, id),
  UNIQUE(tenant_id,establishment_id,ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `printers` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  sector VARCHAR(40) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_printers_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_printers_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `print_agents` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_print_agents_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_print_agents_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `print_jobs` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  ticket_id CHAR(36) NOT NULL,
  printer_id CHAR(36) NOT NULL,
  agent_id CHAR(36) NULL,
  status ENUM('PENDING','PROCESSING','COMPLETED','FAILED') NOT NULL,
  is_copy BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INT NOT NULL DEFAULT 0,
  lease_until DATETIME(3) NULL,
  last_error VARCHAR(255) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_print_jobs_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_print_jobs_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  CONSTRAINT fk_print_jobs_ticket_id FOREIGN KEY (tenant_id, establishment_id, ticket_id) REFERENCES tickets (tenant_id, establishment_id, id),
  CONSTRAINT fk_print_jobs_printer_id FOREIGN KEY (tenant_id, establishment_id, printer_id) REFERENCES printers (tenant_id, establishment_id, id),
  CONSTRAINT fk_print_jobs_agent_id FOREIGN KEY (tenant_id, establishment_id, agent_id) REFERENCES print_agents (tenant_id, establishment_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `audit_logs` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NOT NULL,
  action VARCHAR(100) NOT NULL,
  aggregate_id CHAR(36) NOT NULL,
  metadata JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_audit_logs_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_audit_logs_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `outbox_events` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  event VARCHAR(80) NOT NULL,
  aggregate_id CHAR(36) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  payload JSON NOT NULL,
  published_at DATETIME(3) NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_error VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_outbox_events_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_outbox_events_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  KEY idx_outbox_pending (published_at,next_attempt_at,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `idempotency_records` (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  establishment_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  operation VARCHAR(100) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_idempotency_records_scope (tenant_id, establishment_id, id),
  CONSTRAINT fk_idempotency_records_unit FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id,id),
  UNIQUE(tenant_id,establishment_id,actor_id,idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
