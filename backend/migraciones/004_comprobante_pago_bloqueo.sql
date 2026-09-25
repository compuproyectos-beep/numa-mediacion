-- Punto 5 del feedback del cliente (reunión):
--   1) Al subir el acta final, también se debe subir el comprobante de pago,
--      ambos archivos obligatorios en la misma operación.
--   2) Desde el momento en que un proceso pasa a 'cerrado_con_acuerdo', el
--      mediador asignado tiene 48 horas para subir acta final + comprobante.
--      Mientras esa acta esté pendiente, no puede subir actas finales de
--      OTROS procesos hasta que:
--        a) suba acta + comprobante de ese proceso pendiente, o
--        b) pasen las 48 horas desde que se marcó 'acuerdo' (lo que ocurra primero).

-- Marca desde cuándo empieza a correr el plazo de 48 horas.
ALTER TABLE procesos_mediacion
    ADD COLUMN IF NOT EXISTS fecha_acuerdo TIMESTAMP NULL;

-- Comprobante de pago, guardado junto con el acta final (misma fila,
-- mismo evento de subida) en actas_proceso.
ALTER TABLE actas_proceso
    ADD COLUMN IF NOT EXISTS ruta_comprobante_pago TEXT NULL,
    ADD COLUMN IF NOT EXISTS nombre_comprobante_pago TEXT NULL,
    ADD COLUMN IF NOT EXISTS tamano_comprobante_bytes INTEGER NULL;
