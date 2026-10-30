ALTER TABLE print_jobs
 MODIFY COLUMN ticket_id CHAR(36) NULL,
 ADD COLUMN document_kind ENUM('TICKET','RECEIPT') NOT NULL DEFAULT 'TICKET',
 ADD COLUMN receipt_snapshot JSON NULL,
 ADD COLUMN source_order_id CHAR(36) NULL,
 ADD COLUMN source_tab_id CHAR(36) NULL,
 ADD COLUMN paper_width SMALLINT NOT NULL DEFAULT 80,
 ADD CONSTRAINT fk_print_receipt_order FOREIGN KEY(tenant_id,establishment_id,source_order_id) REFERENCES orders(tenant_id,establishment_id,id),
 ADD CONSTRAINT fk_print_receipt_tab FOREIGN KEY(tenant_id,establishment_id,source_tab_id) REFERENCES tabs(tenant_id,establishment_id,id),
 ADD CONSTRAINT ck_print_paper_width CHECK(paper_width IN (58,80)),
 ADD CONSTRAINT ck_print_document CHECK(
  (document_kind='TICKET' AND ticket_id IS NOT NULL AND receipt_snapshot IS NULL AND source_order_id IS NULL AND source_tab_id IS NULL)
  OR (document_kind='RECEIPT' AND ticket_id IS NULL AND receipt_snapshot IS NOT NULL AND ((source_order_id IS NOT NULL AND source_tab_id IS NULL) OR (source_order_id IS NULL AND source_tab_id IS NOT NULL)))
 );
