'use client';

import { useEffect, useState } from 'react';
import { FileCheck } from 'lucide-react';
import { Spinner, EmptyState } from '@/components/ui';
import { getResumenActasMes } from '@/lib/services';

const mesActual = () => {
  const d = new Date(Date.now() - 5 * 60 * 60 * 1000); // hora de Ecuador
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Cuántas actas COMPLETAS (con el acta firmada subida) lleva cada mediador y
// cada sucursal en el mes. Lo que está a medias no cuenta. Lo ven todos los
// mediadores, con los nombres de mediadores y sucursales.
export default function ResumenActasMes() {
  const [mes, setMes] = useState(mesActual());
  const [datos, setDatos] = useState<any | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(mes)) return;
    setCargando(true);
    setError('');
    getResumenActasMes(mes)
      .then(setDatos)
      .catch(() => setError('No se pudo cargar el resumen de actas'))
      .finally(() => setCargando(false));
  }, [mes]);

  const pastilla = (n: number, tono: 'verde' | 'dorado') =>
    `shrink-0 min-w-[28px] text-center text-xs font-bold px-2 py-0.5 rounded-full ${
      n === 0
        ? 'bg-numa-100 text-numa-400'
        : tono === 'verde'
        ? 'bg-emerald-100 text-emerald-800'
        : 'bg-amber-100 text-amber-800'
    }`;

  return (
    <div className="card p-4 border-l-4 border-l-emerald-500 bg-gradient-to-br from-emerald-50/60 via-white to-white">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-emerald-900 uppercase tracking-wider flex items-center gap-2">
            <span className="w-7 h-7 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <FileCheck className="w-4 h-4" />
            </span>
            Actas completas del mes
          </h2>
          <p className="text-[11px] text-numa-500 mt-0.5">
            Solo cuentan las actas terminadas (con el acta firmada subida).
          </p>
        </div>

        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="input-field !w-auto !py-1 text-xs"
        />
      </div>

      {cargando ? (
        <Spinner />
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !datos || datos.mediadores.length === 0 ? (
        <EmptyState message="No hay mediadores para mostrar." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-md bg-white/70 border border-emerald-100 px-3 py-2">
            <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide mb-1 flex items-center justify-between">
              <span>Por sucursal</span>
              <span className="bg-emerald-600 text-white rounded-full px-2 py-0.5">
                Total {datos.total}
              </span>
            </p>
            <ul className="divide-y divide-emerald-50">
              {datos.sucursales.map((s: any) => (
                <li key={s.sucursal_id} className="flex items-center justify-between gap-2 py-1 text-sm">
                  <span className="text-numa-800 truncate">
                    {s.sucursal} <span className="text-numa-400 text-xs">· {s.ciudad}</span>
                  </span>
                  <span className={pastilla(s.total, 'verde')}>{s.total}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-md bg-white/70 border border-amber-200 px-3 py-2">
            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide mb-1">
              Por mediador
            </p>
            <ul className="divide-y divide-amber-50">
              {datos.mediadores.map((m: any) => (
                <li key={m.usuario_id} className="flex items-center justify-between gap-2 py-1 text-sm">
                  <span className="text-numa-800 truncate">
                    {m.mediador} <span className="text-numa-400 text-xs">· {m.sucursal}</span>
                  </span>
                  <span className={pastilla(m.total, 'dorado')}>{m.total}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
