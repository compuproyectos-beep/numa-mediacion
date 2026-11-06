-- Actas antiguas (papel) registradas a mano por el administrador: no piden facturas ni comprobantes.
ALTER TABLE procesos_mediacion ADD COLUMN IF NOT EXISTS acta_antigua boolean NOT NULL DEFAULT false;
