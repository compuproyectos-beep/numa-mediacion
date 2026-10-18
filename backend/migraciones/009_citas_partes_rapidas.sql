-- Bloque 4: invitación rápida desde la Agenda (sin proceso).
-- Las partes (nombres y cédulas, y representante legal si es empresa) se guardan
-- en la propia invitación hasta que se crea el proceso y se enlaza.
ALTER TABLE citas ADD COLUMN IF NOT EXISTS partes_rapidas jsonb;
