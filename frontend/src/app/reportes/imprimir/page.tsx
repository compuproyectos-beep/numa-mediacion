'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Printer } from 'lucide-react';
import {
  getProcesos,
  getActasFinales,
  getReporteProductividad,
  getReporteSucursales,
  getReporteClientes,
  getReporteResumen,
  ResumenReporte
} from '@/lib/services';
import { BarrasResumen } from '@/components/ui';

type TipoReporte = 'procesos' | 'productividad' | 'actas' | 'sucursales' | 'clientes';

const TITULOS: Record<TipoReporte, string> = {
  procesos: 'Reporte de Procesos por Periodo',
  productividad: 'Reporte del Equipo de Mediadores',
  actas: 'Reporte de Actas Finales Emitidas',
  sucursales: 'Reporte por Sucursal',
  clientes: 'Reporte de Clientes'
};

const COLOR_ESTADO: Record<string, string> = {
  en_negociacion: '#f59e0b',
  cerrado_con_acuerdo: '#22c55e',
  cerrado_sin_acuerdo: '#ef4444',
  archivado: '#94a3b8'
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

// Puede haber sucursales con el mismo nombre en ciudades distintas, así que
// en los gráficos por sucursal se muestra la ciudad entre paréntesis.
const labelSucursal = (s: any) => (s.ciudad ? `${s.sucursal} (${s.ciudad})` : s.sucursal);

export default function ImprimirReportePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-numa-50 text-numa-500 text-sm">
          Generando reporte...
        </div>
      }
    >
      <ImprimirReporteContenido />
    </Suspense>
  );
}

function ImprimirReporteContenido() {
  const searchParams = useSearchParams();

  const tipo = (searchParams?.get('tipo') as TipoReporte) || 'procesos';
  const fecha_desde = searchParams?.get('fecha_desde') || '';
  const fecha_hasta = searchParams?.get('fecha_hasta') || '';
  const ciudad_id = searchParams?.get('ciudad_id') || '';
  const sucursal_id = searchParams?.get('sucursal_id') || '';
  const usuario_id = searchParams?.get('usuario_id') || '';

  const [datos, setDatos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Igual que en pantalla: indicadores de resultado (tasa de acuerdo, tiempo
  // promedio de resolución), que solo aplican al reporte de Procesos.
  const [resumenIndicadores, setResumenIndicadores] = useState<ResumenReporte | null>(null);

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
        : tipo === 'sucursales'
        ? getReporteSucursales(filtros)
        : tipo === 'clientes'
        ? getReporteClientes(filtros)
        : getProcesos(filtros);

    cargar
      .then(setDatos)
      .catch(() => setDatos([]))
      .finally(() => setLoading(false));

    if (tipo === 'procesos') {
      getReporteResumen(filtros)
        .then(setResumenIndicadores)
        .catch(() => setResumenIndicadores(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rangoFechas =
    fecha_desde || fecha_hasta
      ? `Del ${fecha_desde ? new Date(fecha_desde + 'T00:00:00').toLocaleDateString('es-EC') : '—'} al ${
          fecha_hasta ? new Date(fecha_hasta + 'T00:00:00').toLocaleDateString('es-EC') : '—'
        }`
      : 'Todas las fechas';

  // Igual que en pantalla: para el reporte de procesos se cuenta cuántos
  // hay en cada estado, para no dejar solo el total general.
  const resumenProcesos =
    tipo === 'procesos'
      ? datos.reduce(
          (acc: any, p: any) => {
            acc[p.estado] = (acc[p.estado] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        )
      : null;

  const actasPendientesProcesos =
    tipo === 'procesos'
      ? datos.filter((p: any) => p.estado === 'cerrado_con_acuerdo' && !p.finalizado).length
      : 0;

  const barrasResumen: { label: string; valor: number; color?: string }[] | null =
    tipo === 'procesos' && resumenProcesos
      ? Object.entries(resumenProcesos).map(([estado, cantidad]) => ({
          label: getEstadoLabel(estado),
          valor: cantidad as number,
          color: COLOR_ESTADO[estado]
        }))
      : tipo === 'productividad'
      ? datos.map((m: any) => ({ label: m.mediador, valor: m.total_procesos }))
      : tipo === 'sucursales'
      ? datos.map((s: any) => ({ label: labelSucursal(s), valor: s.total_procesos }))
      : null;

  // El sistema gira ante todo en torno a las actas, así que este gráfico se
  // muestra primero, antes que el desglose general — igual que en pantalla.
  const actasSubidasProcesos =
    tipo === 'procesos' ? datos.filter((p: any) => p.finalizado).length : 0;

  const barrasActas: { label: string; valor: number; color?: string }[] | null =
    tipo === 'procesos'
      ? [
          { label: 'Actas subidas', valor: actasSubidasProcesos, color: '#22c55e' },
          { label: 'Actas pendientes', valor: actasPendientesProcesos, color: '#ef4444' }
        ]
      : tipo === 'productividad'
      ? datos
          .filter((m: any) => m.actas_subidas > 0)
          .map((m: any) => ({ label: m.mediador, valor: m.actas_subidas, color: '#22c55e' }))
      : tipo === 'sucursales'
      ? datos
          .filter((s: any) => s.actas_subidas > 0)
          .map((s: any) => ({ label: labelSucursal(s), valor: s.actas_subidas, color: '#22c55e' }))
      : null;

  const barrasActasPendientes: { label: string; valor: number; color?: string }[] | null =
    tipo === 'productividad'
      ? datos
          .filter((m: any) => m.actas_pendientes > 0)
          .map((m: any) => ({ label: m.mediador, valor: m.actas_pendientes, color: '#ef4444' }))
      : tipo === 'sucursales'
      ? datos
          .filter((s: any) => s.actas_pendientes > 0)
          .map((s: any) => ({ label: labelSucursal(s), valor: s.actas_pendientes, color: '#ef4444' }))
      : null;

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
        {/* Encabezado tipo membrete, igual al de los expedientes impresos.
            El logo y el nombre van centrados en la hoja; el botón de
            Imprimir queda flotando aparte (y desaparece al imprimir). */}
        <div className="border-b-2 border-gold-500 px-10 pt-8 pb-6 relative">
          <button
            onClick={() => window.print()}
            className="print:hidden absolute top-8 right-10 inline-flex items-center gap-2 px-4 py-2 bg-numa-900 text-numa-50 rounded-sm text-sm font-medium hover:bg-numa-950 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Imprimir
          </button>

          <div className="flex items-center justify-center gap-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/logo-numa-claro.jpg"
              alt="Centro de Mediación NUMA"
              className="h-20 w-auto object-contain"
            />

            <div>
              <p className="text-[11px] tracking-[0.2em] text-gold-600 font-semibold uppercase mb-1">
                Centro de Mediación
              </p>
              <h1 className="font-display text-2xl font-bold text-numa-900">NUMA</h1>
            </div>
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
            <>
              {resumenProcesos && (
                <table className="w-full text-xs border-collapse mb-6">
                  <thead>
                    <tr className="border-b-2 border-numa-300">
                      <th className="text-left py-2 pr-4 font-semibold text-numa-700">
                        En negociación
                      </th>
                      <th className="text-left py-2 pr-4 font-semibold text-numa-700">
                        Con acuerdo
                      </th>
                      <th className="text-left py-2 pr-4 font-semibold text-numa-700">
                        Sin acuerdo
                      </th>
                      <th className="text-left py-2 pr-4 font-semibold text-numa-700">
                        Archivados
                      </th>
                      <th className="text-left py-2 pr-4 font-semibold text-numa-700">Total</th>
                      <th className="text-left py-2 pr-4 font-semibold text-red-700">
                        Con acuerdo sin acta
                      </th>
                      {resumenIndicadores && resumenIndicadores.tasa_acuerdo !== null && (
                        <th className="text-left py-2 pr-4 font-semibold text-green-700">
                          Tasa de acuerdo
                        </th>
                      )}
                      {resumenIndicadores && resumenIndicadores.promedio_dias_resolucion !== null && (
                        <th className="text-left py-2 pr-4 font-semibold text-numa-700">
                          Prom. días resolución
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-2 pr-4 text-numa-800 text-sm font-semibold">
                        {resumenProcesos.en_negociacion || 0}
                      </td>
                      <td className="py-2 pr-4 text-numa-800 text-sm font-semibold">
                        {resumenProcesos.cerrado_con_acuerdo || 0}
                      </td>
                      <td className="py-2 pr-4 text-numa-800 text-sm font-semibold">
                        {resumenProcesos.cerrado_sin_acuerdo || 0}
                      </td>
                      <td className="py-2 pr-4 text-numa-800 text-sm font-semibold">
                        {resumenProcesos.archivado || 0}
                      </td>
                      <td className="py-2 pr-4 text-numa-900 text-sm font-bold">
                        {datos.length}
                      </td>
                      <td className="py-2 pr-4 text-red-700 text-sm font-bold">
                        {actasPendientesProcesos}
                      </td>
                      {resumenIndicadores && resumenIndicadores.tasa_acuerdo !== null && (
                        <td className="py-2 pr-4 text-green-700 text-sm font-bold">
                          {resumenIndicadores.tasa_acuerdo}%
                        </td>
                      )}
                      {resumenIndicadores && resumenIndicadores.promedio_dias_resolucion !== null && (
                        <td className="py-2 pr-4 text-numa-800 text-sm font-semibold">
                          {resumenIndicadores.promedio_dias_resolucion} días
                        </td>
                      )}
                    </tr>
                  </tbody>
                </table>
              )}

              {/* El gráfico de actas va primero: es el corazón del sistema. */}
              {barrasActas && barrasActas.length > 0 && (
                <div className="mb-6 print:break-inside-avoid">
                  <p className="text-[11px] font-semibold text-numa-700 uppercase tracking-wide mb-2">
                    {tipo === 'procesos'
                      ? 'Actas'
                      : 'Actas subidas por ' + (tipo === 'productividad' ? 'mediador' : 'sucursal')}
                  </p>
                  <BarrasResumen items={barrasActas} />
                </div>
              )}

              {barrasResumen && barrasResumen.length > 0 && (
                <div className="mb-6 print:break-inside-avoid">
                  <BarrasResumen items={barrasResumen} />
                </div>
              )}

              {barrasActasPendientes && barrasActasPendientes.length > 0 && (
                <div className="mb-6 print:break-inside-avoid">
                  <p className="text-[11px] font-semibold text-red-700 uppercase tracking-wide mb-2">
                    Actas pendientes de subir por {tipo === 'productividad' ? 'mediador' : 'sucursal'}
                  </p>
                  <BarrasResumen items={barrasActasPendientes} />
                </div>
              )}

              <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-numa-300">
                  {tipo === 'procesos' && (
                    <>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Código</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Estado</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Acta final</th>
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
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Estado</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Ingreso</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Sucursal</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Total</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">En negociación</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Con acuerdo</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Sin acuerdo</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Archivados</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Actas subidas</th>
                      <th className="text-left py-2 pr-2 font-semibold text-red-700">Actas pendientes</th>
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

                  {tipo === 'sucursales' && (
                    <>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Sucursal</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Ciudad</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Total</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">En negociación</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Con acuerdo</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Sin acuerdo</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Archivados</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Actas subidas</th>
                      <th className="text-left py-2 pr-2 font-semibold text-red-700">Actas pendientes</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Prom. días</th>
                    </>
                  )}

                  {tipo === 'clientes' && (
                    <>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Cliente</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Cédula</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Teléfono</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Email</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Total</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">En negociación</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Con acuerdo</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Sin acuerdo</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Archivados</th>
                      <th className="text-left py-2 pr-2 font-semibold text-numa-700">Actas subidas</th>
                      <th className="text-left py-2 pr-2 font-semibold text-red-700">Actas pendientes</th>
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
                      <td className="py-1.5 pr-2">
                        {p.estado === 'cerrado_con_acuerdo' && !p.finalizado
                          ? 'Pendiente'
                          : p.finalizado
                          ? 'Subida'
                          : '—'}
                      </td>
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
                      <td className="py-1.5 pr-2">{m.activo ? 'Activo' : 'Inactivo'}</td>
                      <td className="py-1.5 pr-2">
                        {m.fecha_ingreso
                          ? new Date(m.fecha_ingreso).toLocaleDateString('es-EC')
                          : '—'}
                      </td>
                      <td className="py-1.5 pr-2">{m.sucursal || '—'}</td>
                      <td className="py-1.5 pr-2">{m.total_procesos}</td>
                      <td className="py-1.5 pr-2">{m.en_negociacion}</td>
                      <td className="py-1.5 pr-2">{m.cerrados_con_acuerdo}</td>
                      <td className="py-1.5 pr-2">{m.cerrados_sin_acuerdo}</td>
                      <td className="py-1.5 pr-2">{m.archivados}</td>
                      <td className="py-1.5 pr-2">{m.actas_subidas}</td>
                      <td className="py-1.5 pr-2 font-semibold text-red-700">{m.actas_pendientes}</td>
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

                {tipo === 'sucursales' &&
                  datos.map((s: any) => (
                    <tr key={s.sucursal_id} className="border-b border-numa-100">
                      <td className="py-1.5 pr-2">{s.sucursal}</td>
                      <td className="py-1.5 pr-2">{s.ciudad || '—'}</td>
                      <td className="py-1.5 pr-2">{s.total_procesos}</td>
                      <td className="py-1.5 pr-2">{s.en_negociacion}</td>
                      <td className="py-1.5 pr-2">{s.cerrados_con_acuerdo}</td>
                      <td className="py-1.5 pr-2">{s.cerrados_sin_acuerdo}</td>
                      <td className="py-1.5 pr-2">{s.archivados}</td>
                      <td className="py-1.5 pr-2">{s.actas_subidas}</td>
                      <td className="py-1.5 pr-2 font-semibold text-red-700">{s.actas_pendientes}</td>
                      <td className="py-1.5 pr-2">
                        {s.promedio_dias_cierre != null ? `${s.promedio_dias_cierre}` : '—'}
                      </td>
                    </tr>
                  ))}

                {tipo === 'clientes' &&
                  datos.map((c: any) => (
                    <tr key={c.cliente_id} className="border-b border-numa-100">
                      <td className="py-1.5 pr-2">{c.cliente}</td>
                      <td className="py-1.5 pr-2 code-text">{c.cedula || '—'}</td>
                      <td className="py-1.5 pr-2">{c.telefono || '—'}</td>
                      <td className="py-1.5 pr-2">{c.email || '—'}</td>
                      <td className="py-1.5 pr-2">{c.total_procesos}</td>
                      <td className="py-1.5 pr-2">{c.en_negociacion}</td>
                      <td className="py-1.5 pr-2">{c.cerrados_con_acuerdo}</td>
                      <td className="py-1.5 pr-2">{c.cerrados_sin_acuerdo}</td>
                      <td className="py-1.5 pr-2">{c.archivados}</td>
                      <td className="py-1.5 pr-2">{c.actas_subidas}</td>
                      <td className="py-1.5 pr-2 font-semibold text-red-700">{c.actas_pendientes}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            </>
          )}

          <p className="text-xs text-numa-400 mt-6 text-right">
            {datos.length} {datos.length === 1 ? 'registro' : 'registros'}
          </p>
        </div>
      </div>
    </main>
  );
}
