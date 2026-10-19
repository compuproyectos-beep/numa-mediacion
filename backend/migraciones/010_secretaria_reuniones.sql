-- Bloque 5 (ya aplicada en Supabase como 010a y 010b)
ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'secretaria';

CREATE TABLE IF NOT EXISTS reuniones_mediadores (
  id serial PRIMARY KEY,
  sucursal_id integer NOT NULL REFERENCES sucursales(id),
  creado_por_id integer REFERENCES usuarios(id),
  titulo varchar(200) NOT NULL DEFAULT 'Reunión de mediadores',
  detalle text,
  fecha date NOT NULL,
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  estado varchar(20) NOT NULL DEFAULT 'activa',
  motivo_cancelacion text,
  fecha_creacion timestamptz NOT NULL DEFAULT now(),
  fecha_modificacion timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reuniones_horas_validas CHECK (hora_fin > hora_inicio),
  CONSTRAINT reuniones_estado_valido CHECK (estado IN ('activa','cancelada'))
);
CREATE INDEX IF NOT EXISTS idx_reuniones_sucursal_fecha ON reuniones_mediadores (sucursal_id, fecha) WHERE estado = 'activa';
ALTER TABLE reuniones_mediadores ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS uq_secretaria_activa_por_sucursal ON usuarios (sucursal_id) WHERE rol = 'secretaria' AND activo = true;
