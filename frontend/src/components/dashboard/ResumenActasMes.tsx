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

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h2 className="text-sm font-semibold text-numa-700 uppercase tracking-wider flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-numa-400" />
          Actas completas del mes
        </h2>

        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="input-field !w-auto text-xs"
        />
      </div>

      <p className="text-xs text-numa-400 mb-4">
        Solo cuentan las actas terminadas (con el acta firmada subida).
      </p>

      {cargando ? (
        <Spinner />
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : !datos || datos.mediadores.length === 0 ? (
        <EmptyState message="No hay mediadores para mostrar." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-semibold text-numa-500 uppercase tracking-wide mb-2">
              Por sucursal · total {datos.total}
            </p>
            <ul className="divide-y divide-numa-100">
              {datos.sucursales.map((s: any) => (
                <li key={s.sucursal_id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-numa-800">
                    {s.sucursal} <span className="text-numa-400">· {s.ciudad}</span>
                  </span>
                  <span className="font-semibold text-numa-900">{s.total}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold text-numa-500 uppercase tracking-wide mb-2">
              Por mediador
            </p>
            <ul className="divide-y divide-numa-100">
              {datos.mediadores.map((m: any) => (
                <li key={m.usuario_id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-numa-800">
                    {m.mediador} <span className="text-numa-400">· {m.sucursal}</span>
                  </span>
                  <span className="font-semibold text-numa-900">{m.total}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
