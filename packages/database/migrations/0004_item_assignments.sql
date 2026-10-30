CREATE TABLE order_item_assignments (
 id CHAR(36) NOT NULL PRIMARY KEY,
 tenant_id CHAR(36) NOT NULL,
 establishment_id CHAR(36) NOT NULL,
 order_item_id CHAR(36) NOT NULL,
 tab_id CHAR(36) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE(tenant_id,establishment_id,id),
 UNIQUE(tenant_id,establishment_id,order_item_id),
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES establishments(tenant_id,id),
 FOREIGN KEY(tenant_id,establishment_id,order_item_id) REFERENCES order_items(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,tab_id) REFERENCES tabs(tenant_id,establishment_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE order_item_transfers (
 id CHAR(36) NOT NULL PRIMARY KEY,
 tenant_id CHAR(36) NOT NULL,
 establishment_id CHAR(36) NOT NULL,
 order_item_id CHAR(36) NOT NULL,
 from_tab_id CHAR(36) NOT NULL,
 target_tab_id CHAR(36) NOT NULL,
 amount DECIMAL(14,2) NOT NULL,
 actor_id CHAR(36) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES establishments(tenant_id,id),
 FOREIGN KEY(tenant_id,establishment_id,order_item_id) REFERENCES order_items(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,from_tab_id) REFERENCES tabs(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,target_tab_id) REFERENCES tabs(tenant_id,establishment_id,id),
 CHECK(amount>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO order_item_assignments(id,tenant_id,establishment_id,order_item_id,tab_id)
SELECT UUID(),i.tenant_id,i.establishment_id,i.id,o.tab_id FROM order_items i JOIN orders o ON o.tenant_id=i.tenant_id AND o.establishment_id=i.establishment_id AND o.id=i.order_id WHERE o.status='CONFIRMED' AND o.tab_id IS NOT NULL;
