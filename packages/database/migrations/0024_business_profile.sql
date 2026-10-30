-- Informações públicas opcionais e próprias de cada filial. Cadastros existentes são preservados.
ALTER TABLE establishments ADD COLUMN business_profile JSON NULL;
