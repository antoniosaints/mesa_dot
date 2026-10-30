ALTER TABLE print_jobs
  MODIFY COLUMN status ENUM('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED') NOT NULL,
  ADD COLUMN cancelled_at DATETIME(3) NULL,
  ADD COLUMN cancelled_by CHAR(36) NULL,
  ADD COLUMN cancellation_reason VARCHAR(255) NULL,
  ADD CONSTRAINT fk_print_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id);
