// Ayudas para saber si un proceso lleva acta (de acuerdo o de no acuerdo) y
// para mostrar los pagos en abonos. Un solo lugar para que la lista, el
// detalle, el panel y los reportes se comporten igual.

// ¿El proceso pasa por el flujo de acta (acta + comprobante + acta firmada)?
// Sí cuando cerró con acuerdo, o cuando cerró sin acuerdo y el mediador pidió
// el acta de no acuerdo.
export const conActa = (p: any): boolean =>
  !!p &&
  (p.estado === 'cerrado_con_acuerdo' ||
    (p.estado === 'cerrado_sin_acuerdo' && !!p.requiere_acta_no_acuerdo));

export const esNoAcuerdo = (p: any): boolean => !!p && p.estado === 'cerrado_sin_acuerdo';

// $1,250.00
export const dinero = (v: any): string => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return `$${n.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Saldo que falta por pagar cuando el pago es en abonos.
export const saldoPago = (p: any): number | null =>
  p && p.monto_total != null && p.abono1_monto != null
    ? Number(p.monto_total) - Number(p.abono1_monto)
    : null;

// "2026-10-13" -> "13/10/2026" (sin pasar por Date, para no mover el día por la zona horaria)
export const fechaDia = (v?: string | null): string => {
  if (!v) return '—';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};
