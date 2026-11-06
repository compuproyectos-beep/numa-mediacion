-- Pagos en efectivo (pendientes de depositar) y marca "el cliente no quiere factura".
CREATE TABLE IF NOT EXISTS pagos_efectivo (
  id SERIAL PRIMARY KEY,
  proceso_id INTEGER NOT NULL REFERENCES procesos_mediacion(id) ON DELETE CASCADE,
  concepto VARCHAR(10) NOT NULL CHECK (concepto IN ('pago','abono1','saldo')),
  monto NUMERIC(12,2),
  fecha_recibido DATE NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  depositado BOOLEAN NOT NULL DEFAULT false,
  fecha_deposito TIMESTAMPTZ,
  depositado_por INTEGER REFERENCES usuarios(id),
  creado TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pagos_efectivo_proceso ON pagos_efectivo(proceso_id);
CREATE INDEX IF NOT EXISTS idx_pagos_efectivo_pend ON pagos_efectivo(depositado) WHERE depositado = false;
ALTER TABLE pagos_efectivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE procesos_mediacion ADD COLUMN IF NOT EXISTS sin_factura BOOLEAN NOT NULL DEFAULT false;
