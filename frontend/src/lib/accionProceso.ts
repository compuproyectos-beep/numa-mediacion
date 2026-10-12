// Ayudas para decirle al usuario QUÉ le toca hacer en cada proceso, con la
// hora de Ecuador (el servidor y el navegador pueden estar en otra zona).

const ZONA = 'America/Guayaquil';

// "2026-10-12"
export function hoyEcuador(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
}

// "2026-10-12 15:30" — para comparar contra la fecha y hora de una invitación.
function ahoraEcuador(): string {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());

  return `${hoyEcuador()} ${partes}`;
}

export function sumarDias(fechaISO: string, dias: number): string {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ¿Ya pasó la hora de la invitación?
export function citaYaPaso(fecha?: string | null, hora?: string | null): boolean {
  if (!fecha) return false;
  const f = String(fecha).slice(0, 10);
  const h = String(hora || '00:00').slice(0, 5);
  return `${f} ${h}` < ahoraEcuador();
}

export interface AccionProceso {
  texto: string;
  // true = hay algo que hacer ahora; false = solo consultar o esperar.
  urgente: boolean;
  // Para ordenar "lo que toca hacer": menor número = más importante.
  prioridad: number;
}

export function accionProceso(p: any, esAdmin = false): AccionProceso {
  if (p.estado === 'en_negociacion') {
    if (p.proxima_cita_fecha) {
      return citaYaPaso(p.proxima_cita_fecha, p.proxima_cita_hora)
        ? { texto: 'Registrar resultado', urgente: true, prioridad: 0 }
        : { texto: 'Ver invitación', urgente: false, prioridad: 9 };
    }
    return { texto: 'Agendar invitación', urgente: true, prioridad: 3 };
  }

  if (p.estado === 'cerrado_con_acuerdo') {
    if (p.etapa_acta === 'falta_firmada') {
      return { texto: 'Subir acta firmada', urgente: true, prioridad: 1 };
    }

    if (p.etapa_acta === 'falta_acta') {
      // El administrador no está sujeto a la fila de actas.
      if (p.bloqueante_id && !esAdmin) {
        return { texto: 'Esperando turno', urgente: false, prioridad: 9 };
      }
      return { texto: 'Subir acta', urgente: true, prioridad: 2 };
    }
  }

  return { texto: 'Ver', urgente: false, prioridad: 9 };
}
