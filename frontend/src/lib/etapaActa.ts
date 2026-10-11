// Etiqueta y color de la etapa del acta de un proceso cerrado con acuerdo:
// falta_acta -> falta_firmada -> completa (o suspendido). Devuelve null si no
// hay nada que mostrar (proceso que no cerró con acuerdo, o ya completo).
export function etapaActaBadge(p: any): { label: string; className: string } | null {
  if (!p || p.estado !== 'cerrado_con_acuerdo') return null;

  switch (p.etapa_acta) {
    case 'suspendido':
      return { label: 'Suspendido', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'falta_acta':
      return p.acta_primero_en_fila
        ? { label: 'Falta subir acta', className: 'bg-red-50 text-red-700 border-red-200' }
        : { label: 'Acta pendiente (en espera)', className: 'bg-numa-100 text-numa-500 border-numa-200' };
    case 'falta_firmada':
      return { label: 'Falta acta firmada', className: 'bg-red-50 text-red-700 border-red-200' };
    default:
      return null;
  }
}
