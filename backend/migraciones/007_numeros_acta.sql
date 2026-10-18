-- Bloque 3: número de acta por sucursal (consecutivo, a prueba de concurrencia)
-- Aditiva: no modifica ni borra nada existente.

CREATE TABLE IF NOT EXISTS numeros_acta (
    id                SERIAL PRIMARY KEY,
    sucursal_id       INTEGER NOT NULL REFERENCES sucursales(id),
    secuencial        INTEGER NOT NULL,
    codigo            VARCHAR(40) NOT NULL,
    estado            VARCHAR(12) NOT NULL DEFAULT 'reservado'
                      CHECK (estado IN ('reservado', 'usado', 'anulado')),
    usuario_id        INTEGER REFERENCES usuarios(id),
    proceso_id        INTEGER REFERENCES procesos_mediacion(id),
    fecha_solicitud   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_uso         TIMESTAMPTZ,
    anulado_por       INTEGER REFERENCES usuarios(id),
    motivo_anulacion  TEXT,
    fecha_anulacion   TIMESTAMPTZ,
    aviso_fecha       TIMESTAMPTZ
);

-- Un mismo número nunca se repite dentro de una sucursal.
CREATE UNIQUE INDEX IF NOT EXISTS ux_numeros_acta_sucursal_sec
    ON numeros_acta (sucursal_id, secuencial);

-- Un mediador solo puede tener UN número pedido sin completar a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS ux_numeros_acta_un_reservado_por_mediador
    ON numeros_acta (usuario_id) WHERE estado = 'reservado';

CREATE INDEX IF NOT EXISTS ix_numeros_acta_estado ON numeros_acta (estado);

-- Las actas que ya existen conservan su número y la numeración continúa después.
INSERT INTO numeros_acta (sucursal_id, secuencial, codigo, estado, usuario_id, proceso_id, fecha_solicitud, fecha_uso)
SELECT p.sucursal_id,
       CAST(split_part(ap.codigo_acta, '-', 3) AS INTEGER),
       ap.codigo_acta, 'usado', ap.usuario_id, ap.proceso_id, ap.fecha_subida, ap.fecha_subida
FROM actas_proceso ap
JOIN procesos_mediacion p ON p.id = ap.proceso_id
WHERE ap.codigo_acta ~ '^[A-Z0-9]+-[A-Z0-9]+-[0-9]+$'
ON CONFLICT DO NOTHING;
