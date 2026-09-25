'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Printer } from 'lucide-react';
import { getProcesos, getActasFinales, getReporteProductividad } from '@/lib/services';

type TipoReporte = 'procesos' | 'productividad' | 'actas';

const TITULOS: Record<TipoReporte, string> = {
  procesos: 'Reporte de Procesos por Periodo',
  productividad: 'Reporte de Productividad por Mediador',
  actas: 'Reporte de Actas Finales Emitidas'
};

const getEstadoLabel = (estado: string) => {
  const labels: any = {
    en_negociacion: 'En negociación',
    cerrado_con_acuerdo: 'Cerrado con acuerdo',
    cerrado_sin_acuerdo: 'Cerrado sin acuerdo',
    archivado: 'Archivado'
  };

  return labels[estado] || estado;
};

export default function ImprimirReportePage() {
  const searchParams = useSearchParams();

  const tipo = (searchParams?.get('tipo') as TipoReporte) || 'procesos';
  const fecha_desde = searchParams?.get('fecha_desde') || '';
  const fecha_hasta = searchParams?.get('fecha_hasta') || '';
  const ciudad_id = searchParams?.get('ciudad_id') || '';
  const sucursal_id = searchParams?.get('sucursal_id') || '';
  const usuario_id = searchParams?.get('usuario_id') || '';

  const [datos, setDatos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const filtros = {
      fecha_desde: fecha_desde || undefined,
      fecha_hasta: fecha_hasta || undefined,
      ciudad_id: ciudad_id || undefined,
      sucursal_id: sucursal_id || undefined,
      usuario_id: usuario_id || undefined
    };

    const cargar =
      tipo === 'productividad'
        ? getReporteProductividad(filtros)
        : tipo === 'actas'
        ? getActasFinales(filtros)
        : getProcesos(filtros);

    cargar
      .then(setDatos)
      .catch(() => setDatos([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rangoFechas =
    fecha_desde || fecha_hasta
      ? `Del ${fecha_desde ? new Date(fecha_desde + 'T00:00:00').toLocaleDateString('es-EC') : '—'} al ${
          fecha_hasta ? new Date(fecha_hasta + 'T00:00:00').toLocaleDateString('es-EC') : '—'
        }`
      : 'Todas las fechas';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-numa-50 text-numa-500 text-sm">
        Generando reporte...
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-numa-100 print:bg-white py-10 print:py-0">
      <div className="max-w-5xl mx-auto bg-white shadow-md print:shadow-none border border-numa-200 print:border-0 rounded-sm">
        {/* Encabezado tipo membrete, igual al de los expedientes impresos */}
        <div className="border-b-2 border-gold-500 px-10 pt-8 pb-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] tracking-[0.2em] text-gold-600 font-semibold uppercase mb-1">
                Centro de Mediación
              </p>
              <h1 className="font-display text-2xl font-bold text-numa-900">NUMA</h1>
            </div>

            <button
              onClick={() => window.print()}
              className="print:hidden inline-flex items-center gap-2 px-4 py-2 bg-numa-900 text-numa-50 rounded-sm text-sm font-medium hover:bg-numa-950 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Imprimir
            </button>
          </div>

          <div className="mt-6">
            <h2 className="font-display text-xl font-bold text-numa-900">{TITULOS[tipo]}</h2>
            <p className="text-sm text-numa-500 mt-1">{rangoFechas}</p>
            <p className="text-xs text-numa-400 mt-1">
              Generado el {new Date().toLocaleString('es-EC')}
            </p>
          </div>
        </div>

        <div className="px-10 py-6">
          {datos.length === 0 ? (
            <p className="text-sm text-numa-400 text-center py-10">
              No hay resultados con esos filtros.
            </p>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-numa-300">
                  {tipo === 'procesos' && (
                    <>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Código</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Estado</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Solicitante</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Invitado</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Ciudad</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Sucursal</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Mediador</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Fecha</th>
                    </>
                  )}

                  {tipo === 'productividad' && (
                    <>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Mediador</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Sucursal</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Total</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">En negociación</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Con acuerdo</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Sin acuerdo</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Archivados</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Prom. días</th>
                    </>
                  )}

                  {tipo === 'actas' && (
                    <>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Código acta</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Proceso</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Solicitante</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Invitado</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Sucursal</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Mediador</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Fecha subida</th>
                    </>
                  )}
                </tr>
              </thead>

              <tbody>
                {tipo === 'procesos' &&
                  datos.map((p: any) => (
                    <tr key={p.id} className="border-b border-numa-100">
                      <td className="py-1.5 pr-2 code-text">{p.codigo_proceso}</td>
                      <td className="py-1.5 pr-2">{getEstadoLabel(p.estado)}</td>
                      <td className="py-1.5 pr-2">{p.demandante}</td>
                      <td className="py-1.5 pr-2">{p.demandado}</td>
                      <td className="py-1.5 pr-2">{p.ciudad || '—'}</td>
                      <td className="py-1.5 pr-2">{p.sucursal || '—'}</td>
                      <td className="py-1.5 pr-2">{p.usuario || '—'}</td>
                      <td className="py-1.5 pr-2">
                        {p.fecha_creacion
                          ? new Date(p.fecha_creacion).toLocaleDateString('es-EC')
                          : '—'}
                      </td>
                    </tr>
                  ))}

                {tipo === 'productividad' &&
                  datos.map((m: any) => (
                    <tr key={m.usuario_id} className="border-b border-numa-100">
                      <td className="py-1.5 pr-2">{m.mediador}</td>
                      <td className="py-1.5 pr-2">{m.sucursal || '—'}</td>
                      <td className="py-1.5 pr-2">{m.total_procesos}</td>
                      <td className="py-1.5 pr-2">{m.en_negociacion}</td>
                      <td className="py-1.5 pr-2">{m.cerrados_con_acuerdo}</td>
                      <td className="py-1.5 pr-2">{m.cerrados_sin_acuerdo}</td>
                      <td className="py-1.5 pr-2">{m.archivados}</td>
                      <td className="py-1.5 pr-2">
                        {m.promedio_dias_cierre != null ? `${m.promedio_dias_cierre}` : '—'}
                      </td>
                    </tr>
                  ))}

                {tipo === 'actas' &&
                  datos.map((a: any) => (
                    <tr key={a.id} className="border-b border-numa-100">
                      <td className="py-1.5 pr-2 code-text">{a.codigo_acta}</td>
                      <td className="py-1.5 pr-2 code-text">{a.codigo_proceso}</td>
                      <td className="py-1.5 pr-2">{a.demandante}</td>
                      <td className="py-1.5 pr-2">{a.demandado}</td>
                      <td className="py-1.5 pr-2">{a.sucursal || '—'}</td>
                      <td className="py-1.5 pr-2">{a.usuario || '—'}</td>
                      <td className="py-1.5 pr-2">
                        {a.fecha_subida
                          ? new Date(a.fecha_subida).toLocaleDateString('es-EC')
                          : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          <p className="text-xs text-numa-400 mt-6 text-right">
            {datos.length} {datos.length === 1 ? 'registro' : 'registros'}
          </p>
        </div>
      </div>
    </main>
  );
}
