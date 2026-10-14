import { ETAPA_PILL } from './estados';
import { conActa } from './actaProceso';

// Etiqueta y color de la etapa del acta de un proceso cerrado con acuerdo:
// falta_acta -> falta_firmada -> completa (o suspendido). Devuelve null si no
// hay nada que mostrar (proceso que no cerró con acuerdo, o ya completo).
export function etapaActaBadge(p: any): { label: string; pill: string; dot: string } | null {
  if (!conActa(p)) return null;

  switch (p.etapa_acta) {
    case 'suspendido':
      return { label: 'Suspendido', ...ETAPA_PILL.pausa };
    case 'falta_acta':
      return p.acta_primero_en_fila
        ? { label: 'Falta subir acta', ...ETAPA_PILL.atencion }
        : { label: 'Acta pendiente (en espera)', ...ETAPA_PILL.espera };
    case 'falta_firmada':
      return {
        label: p.pago_pendiente ? 'Falta acta firmada y 2.º pago' : 'Falta acta firmada',
        ...ETAPA_PILL.atencion
      };
    default:
      return null;
  }
}
