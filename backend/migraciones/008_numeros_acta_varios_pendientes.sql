-- Regla de las 48 horas: un mediador puede tener varios números de acta pedidos
-- a la vez (varias reuniones el mismo día). Se quita el límite de uno por mediador.
DROP INDEX IF EXISTS ux_numeros_acta_un_reservado_por_mediador;
CREATE INDEX IF NOT EXISTS ix_numeros_acta_mediador_estado ON numeros_acta (usuario_id, estado);
