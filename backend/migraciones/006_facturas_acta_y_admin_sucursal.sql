-- Bloque 2 (cambios pedidos por el abogado, octubre 2026).
-- Ya aplicada en Supabase el 18/10/2026; este archivo queda como registro.

-- Facturas por acta culminada: la de NUMA al cliente y la del mediador a NUMA.
-- Guardan historial: al reemplazar un PDF la anterior queda como no vigente.
CREATE TABLE IF NOT EXISTS proceso_facturas (
    id SERIAL PRIMARY KEY,
    proceso_id INTEGER NOT NULL REFERENCES procesos_mediacion(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('cliente', 'mediador')),
    ruta TEXT NOT NULL,
    nombre TEXT,
    tamano_bytes INTEGER,
    usuario_id INTEGER REFERENCES usuarios(id),
    fecha_subida TIMESTAMP NOT NULL DEFAULT NOW(),
    vigente BOOLEAN NOT NULL DEFAULT true,
    reemplazada_en TIMESTAMP NULL
);

-- Una sola factura vigente de cada tipo por proceso.
CREATE UNIQUE INDEX IF NOT EXISTS uq_proceso_factura_vigente
    ON proceso_facturas (proceso_id, tipo) WHERE vigente;
CREATE INDEX IF NOT EXISTS idx_proceso_facturas_proceso ON proceso_facturas (proceso_id);

-- Solo los procesos cuya acta firmada se suba de ahora en adelante exigen
-- facturas (los anteriores son datos de prueba). El aviso al administrador
-- (5 días sin ambas facturas) se envía una sola vez por proceso.
ALTER TABLE procesos_mediacion
    ADD COLUMN IF NOT EXISTS requiere_facturas BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS facturas_aviso_fecha TIMESTAMP NULL;

-- Responsable (administrador) de cada sucursal: su teléfono y correo salen
-- en el encabezado de las invitaciones.
ALTER TABLE sucursales
    ADD COLUMN IF NOT EXISTS admin_telefono VARCHAR(30) NULL,
    ADD COLUMN IF NOT EXISTS admin_email VARCHAR(150) NULL;
