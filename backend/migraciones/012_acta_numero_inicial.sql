-- Primer número de acta que entrega el sistema en cada sucursal. Sirve para
-- empezar en un número mayor (por ejemplo 34) cuando las actas anteriores ya
-- existen en papel. Por defecto empieza en 1.
ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS acta_numero_inicial integer NOT NULL DEFAULT 1 CHECK (acta_numero_inicial >= 1);
UPDATE sucursales SET acta_numero_inicial = 34 WHERE id = 18;
