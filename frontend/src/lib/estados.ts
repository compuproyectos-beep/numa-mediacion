// Colores y nombres de los estados de un proceso, en UN solo lugar para que
// la lista, el detalle, el panel y los reportes se vean iguales.
//
// Significado de los colores en todo el sistema:
//   azul   = en curso (en negociación)
//   verde  = terminó bien (con acuerdo, completo)
//   ámbar  = falta algo / requiere atención
//   rojo   = anulado o atrasado
//   gris   = cerrado sin acuerdo, archivado, suspendido (ya no avanza)

export const ESTADO_LABEL: Record<string, string> = {
  en_negociacion: 'En negociación',
  cerrado_con_acuerdo: 'Cerrado con acuerdo',
  cerrado_sin_acuerdo: 'Cerrado sin acuerdo',
  archivado: 'Archivado',
  anulado: 'Anulado'
};

// Clases de la etiqueta (fondo, texto, borde) y del punto.
const ESTADO_PILL: Record<string, { pill: string; dot: string }> = {
  en_negociacion: { pill: 'bg-sky-50 text-sky-800 border-sky-200', dot: 'bg-sky-500' },
  cerrado_con_acuerdo: { pill: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  cerrado_sin_acuerdo: { pill: 'bg-stone-100 text-stone-700 border-stone-200', dot: 'bg-stone-500' },
  archivado: { pill: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  anulado: { pill: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' }
};

// Franja de color a la izquierda de cada tarjeta de proceso.
const ESTADO_FRANJA: Record<string, string> = {
  en_negociacion: 'border-l-sky-400',
  cerrado_con_acuerdo: 'border-l-emerald-500',
  cerrado_sin_acuerdo: 'border-l-stone-400',
  archivado: 'border-l-slate-300',
  anulado: 'border-l-red-400'
};

// Colores para gráficos (mismo significado que las etiquetas).
export const ESTADO_COLOR_GRAFICO: Record<string, string> = {
  en_negociacion: '#0EA5E9',
  cerrado_con_acuerdo: '#10B981',
  cerrado_sin_acuerdo: '#78716C',
  archivado: '#CBD5E1',
  anulado: '#EF4444'
};

export const estadoLabel = (estado: string) => ESTADO_LABEL[estado] || estado;

export const estadoPill = (estado: string) =>
  ESTADO_PILL[estado] || { pill: 'bg-numa-100 text-numa-700 border-numa-200', dot: 'bg-numa-400' };

export const estadoFranja = (estado: string) => ESTADO_FRANJA[estado] || 'border-l-numa-200';

// Etiquetas de la etapa del acta (después de cerrar con acuerdo).
export const ETAPA_PILL = {
  atencion: { pill: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  espera: { pill: 'bg-numa-50 text-numa-600 border-numa-200', dot: 'bg-numa-400' },
  pausa: { pill: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  listo: { pill: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' }
};
