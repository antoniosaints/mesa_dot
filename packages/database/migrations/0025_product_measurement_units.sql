CREATE TABLE measurement_units (
  code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  symbol VARCHAR(12) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO measurement_units (code,name,symbol,sort_order) VALUES
('UN','Unidade','un',0),
('KG','Quilograma','kg',1),
('G','Grama','g',2),
('MG','Miligrama','mg',3),
('L','Litro','L',4),
('ML','Mililitro','ml',5),
('DZ','Dúzia','dz',6),
('CX','Caixa','cx',7),
('PCT','Pacote','pct',8),
('FD','Fardo','fd',9),
('GRF','Garrafa','grf',10),
('LT','Lata','lata',11),
('PR','Porção','porção',12);

ALTER TABLE products ADD COLUMN unit_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'UN', ADD CONSTRAINT fk_product_measurement_unit FOREIGN KEY (unit_code) REFERENCES measurement_units(code);
ALTER TABLE stock_movements ADD COLUMN unit_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'UN';
ALTER TABLE stock_replenishment_items ADD COLUMN unit_code VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'UN';
