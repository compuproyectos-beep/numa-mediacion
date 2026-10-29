'use client';

import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { getHistorialInvitaciones } from '@/lib/services';
import { estadoLabel } from '@/lib/estados';

const ORDINALES = ['1.ª', '2.ª', '3.ª', '4.ª', '5.ª', '6.ª', '7.ª', '8.ª', '9.ª', '10.ª'];

const fechaLarga = (f: any) => {
  const t = new Date(`${String(f).slice(0, 10)}T00:00:00`).toLocaleDateString('es-EC', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const ESTADO_CITA: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'bg-amber-100 text-amber-800' },
  confirmada: { texto: 'Confirmada', clase: 'bg-amber-100 text-amber-800' },
  realizada: { texto: 'Realizada', clase: 'bg-green-100 text-green-800' },
  no_realizada: { texto: 'No realizada', clase: 'bg-slate-200 text-slate-800' },
  cancelada: { texto: 'Cancelada', clase: 'bg-red-100 text-red-800' }
};

// Historial de las invitaciones de un proceso (1.ª, 2.ª...) dentro del detalle
// de una invitación de la Agenda. Solo se muestra cuando hay más de una.
export default function HistorialInvitaciones({ citaId, procesoId }: { citaId: number; procesoId?: number | null }) {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (!procesoId) {
      setItems([]);
      return;
    }
    let vigente = true;
    getHistorialInvitaciones(citaId)
      .then((d) => vigente && setItems(d || []))
      .catch(() => vigente && setItems([]));
    return () => {
      vigente = false;
    };
  }, [citaId, procesoId]);

  if (!procesoId || items.length < 2) return null;

  return (
    <div className="mb-4 border border-numa-300 rounded-md bg-white shadow-sm">
      <p className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-numa-900 border-b border-numa-200 bg-numa-50 rounded-t-md">
        <History className="w-4 h-4 text-gold-600" aria-hidden="true" />
        Historial de invitaciones de este proceso ({items.length})
      </p>
      <ol className="divide-y divide-numa-100">
        {items.map((it, i) => {
          const est = ESTADO_CITA[it.estado] || { texto: it.estado, clase: 'bg-slate-100 text-slate-800' };
          const actual = it.id === citaId;
          return (
            <li key={it.id} className={`px-4 py-3 text-sm ${actual ? 'bg-gold-50' : ''}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-bold text-numa-900">
                  {ORDINALES[i] || `${i + 1}.ª`} invitación
                </span>
                <span className="text-numa-800">
                  {fechaLarga(it.fecha)} — {String(it.hora).slice(0, 5)}
                </span>
                <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${est.clase}`}>{est.texto}</span>
                {actual && <span className="text-xs font-semibold text-gold-700">(esta invitación)</span>}
              </div>
              {it.resultado && (
                <p className="mt-1 text-numa-800">
                  <span className="font-semibold text-numa-700">Resultado:</span> {estadoLabel(it.resultado)}
                </p>
              )}
              {it.observacion_resultado && (
                <p className="mt-0.5 text-numa-800 whitespace-pre-line">
                  <span className="font-semibold text-numa-700">Observaciones:</span> {it.observacion_resultado}
                </p>
              )}
              {it.observaciones && (
                <p className="mt-0.5 text-numa-700 whitespace-pre-line">
                  <span className="font-semibold">Nota de la invitación:</span> {it.observaciones}
                </p>
              )}
              {it.estado === 'cancelada' && it.motivo_cancelacion && (
                <p className="mt-0.5 text-red-700">
                  <span className="font-semibold">Motivo de cancelación:</span> {it.motivo_cancelacion}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
