-- Coordinador de sucursal: un mediador común marcado como responsable de la sede.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS es_coordinador boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_coordinador_activo_por_sucursal
  ON usuarios (sucursal_id) WHERE es_coordinador = true AND activo = true;
