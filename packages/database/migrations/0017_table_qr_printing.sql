ALTER TABLE print_jobs
 DROP CHECK ck_print_document,
 MODIFY COLUMN document_kind ENUM('TICKET','RECEIPT','TABLE_QR') NOT NULL DEFAULT 'TICKET',
 ADD COLUMN table_qr_snapshot JSON NULL,
 ADD COLUMN source_table_id CHAR(36) NULL,
 ADD CONSTRAINT fk_print_table_qr FOREIGN KEY(tenant_id,establishment_id,source_table_id) REFERENCES dining_tables(tenant_id,establishment_id,id),
 ADD CONSTRAINT ck_print_document CHECK(
  (document_kind='TICKET' AND ticket_id IS NOT NULL AND receipt_snapshot IS NULL AND table_qr_snapshot IS NULL AND source_order_id IS NULL AND source_tab_id IS NULL AND source_table_id IS NULL)
  OR (document_kind='RECEIPT' AND ticket_id IS NULL AND receipt_snapshot IS NOT NULL AND table_qr_snapshot IS NULL AND source_table_id IS NULL AND ((source_order_id IS NOT NULL AND source_tab_id IS NULL) OR (source_order_id IS NULL AND source_tab_id IS NOT NULL)))
  OR (document_kind='TABLE_QR' AND ticket_id IS NULL AND receipt_snapshot IS NULL AND table_qr_snapshot IS NOT NULL AND source_table_id IS NOT NULL AND source_order_id IS NULL AND source_tab_id IS NULL)
 );
