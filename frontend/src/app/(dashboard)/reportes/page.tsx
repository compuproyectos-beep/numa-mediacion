'use client';

import { Fragment, useEffect, useState } from 'react';
import { FileSpreadsheet, Printer, Search, ChevronDown, ChevronRight, Info } from 'lucide-react';
import {
  PageHeader,
  Spinner,
  EmptyState,
  SelectField,
  InputField,
  ErrorAlert,
  Badge,
  BarrasResumen
} from '@/components/ui';
import {
  getProcesos,
  getActasFinales,
  getReporteProductividad,
  getReporteSucursales,
  getReporteClientes,
  getReporteOperativo,
  getReporteResumen,
  ResumenReporte,
  descargarReporteExcel,
  getUsuarios
} from '@/lib/services';
import { getCiudadesCached, getSucursalesCached } from '@/lib/catalogCache';
import { isAdmin } from '@/lib/auth';

type TipoReporte =
  | 'procesos'
  | 'productividad'
  | 'actas'
  | 'sucursales'
  | 'clientes'
  | 'agenda'
  | 'sin-avance'
  | 'actas-pendientes';

const TIPOS_OPERATIVOS: TipoReporte[] = ['agenda', 'sin-avance', 'actas-pendientes'];

const ETIQUETAS_CITA: Record<string, string> = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  realizada: 'Realizada',
  cancelada: 'Cancelada'
};

const formatoFecha = (v: any) => {
  if (!v) return '—';
  const [y, m, d] = String(v).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const TIPOS: { valor: TipoReporte; titulo: string; adminOnly?: boolean }[] = [
  { valor: 'procesos', titulo: 'Procesos por periodo' },
  { valor: 'productividad', titulo: 'Equipo de mediadores', adminOnly: true },
  { valor: 'actas', titulo: 'Actas finales emitidas' },
  { valor: 'sucursales', titulo: 'Sucursales', adminOnly: true },
  { valor: 'clientes', titulo: 'Clientes' },
  { valor: 'agenda', titulo: 'Agenda de reuniones' },
  { valor: 'sin-avance', titulo: 'Procesos sin avance' },
  { valor: 'actas-pendientes', titulo: 'Actas pendientes de subir' }
];

// Explicación en palabras simples de qué muestra cada reporte y cómo leer
// sus columnas, para que quien lo use (no solo quien lo programó) entienda
// los números sin tener que preguntar.
const DESCRIPCIONES: Record<TipoReporte, string> = {
  procesos:
    'Lista todos los procesos de mediación creados en el rango de fechas elegido, con su estado actual. Da clic en cualquier fila para abrir ese proceso. "Tasa de acuerdo" es, de los procesos ya resueltos (con o sin acuerdo — los archivados no cuentan porque no llegaron a resolverse), qué porcentaje terminó con acuerdo.',
  productividad:
    'El listado del equipo de mediadores (activos e inactivos), con cuántos procesos maneja cada uno y qué tan rápido los resuelve. "Prom. días cierre" es el promedio de días entre que se crea un proceso y se cierra (con o sin acuerdo, o archivado); mientras más bajo, más rápido resuelve. Da clic en un mediador para ver el detalle de sus procesos.',
  actas:
    'Lista todas las actas finales subidas en el rango de fechas elegido. Da clic en cualquier fila para abrir el proceso al que pertenece esa acta.',
  sucursales:
    'Compara cuántos procesos ha manejado cada sucursal, con su desglose por estado y el promedio de días de cierre.',
  clientes:
    'Por cada cliente, cuántos procesos de mediación ha tenido (como solicitante o invitado) y en qué estado están. Da clic en un cliente para ver el detalle de sus procesos.',
  agenda:
    'Las reuniones (invitaciones) programadas en el rango de fechas elegido. Las marcadas como "Atrasada" ya pasaron y siguen sin resultado registrado. Da clic en una fila para abrir el proceso.',
  'sin-avance':
    'Procesos que siguen en negociación y llevan al menos esos días sin que se registre ningún avance. Sirve para saber cuáles se están quedando olvidados. Los días se cuentan desde el último avance (o desde que se creó el proceso, si nunca tuvo uno).',
  'actas-pendientes':
    'Procesos cerrados con acuerdo cuya acta final todavía no se sube. Desde el cierre hay 48 horas para subirla; "Vencido" significa que ese plazo ya pasó.'
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
    archivado: 'Archivado',
    anulado: 'Anulado'
  };

  return labels[estado] || estado;
};

// Puede haber sucursales con el mismo nombre en ciudades distintas (p. ej.
// "NORTE" en dos ciudades), así que en los gráficos por sucursal se muestra
// la ciudad entre paréntesis para no confundirlas.
const labelSucursal = (s: any) => (s.ciudad ? `${s.sucursal} (${s.ciudad})` : s.sucursal);

export default function ReportesPage() {
  const admin = isAdmin();

  const tiposVisibles = TIPOS.filter((t) => !t.adminOnly || admin);

  const [tipo, setTipo] = useState<TipoReporte>('procesos');
  const [diasMinimo, setDiasMinimo] = useState('7');
  const esOperativo = TIPOS_OPERATIVOS.includes(tipo);

  const [filters, setFilters] = useState({
    fecha_desde: '',
    fecha_hasta: '',
    ciudad_id: '',
    sucursal_id: '',
    usuario_id: ''
  });

  const [sucursales, setSucursales] = useState<any[]>([]);
  const [ciudades, setCiudades] = useState<any[]>([]);
  const [mediadores, setMediadores] = useState<any[]>([]);

  const [datos, setDatos] = useState<any[]>([]);
  // Indicadores de resultado (% de acuerdo, tiempo promedio) — se cargan
  // junto con el reporte de "Procesos por periodo", usando los mismos
  // filtros, y respetando el mismo alcance (un mediador solo ve lo suyo).
  const [resumenIndicadores, setResumenIndicadores] = useState<ResumenReporte | null>(null);
  const [buscado, setBuscado] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState('');

  // Detalle expandible del reporte de productividad: al dar clic en un
  // mediador se cargan (y se guardan en caché) sus propios procesos del
  // mismo rango de fechas, para no tener que adivinar qué hay "adentro"
  // de cada número.
  const [mediadorExpandidoId, setMediadorExpandidoId] = useState<number | null>(null);
  const [detalleProcesos, setDetalleProcesos] = useState<Record<number, any[]>>({});
  const [cargandoDetalleId, setCargandoDetalleId] = useState<number | null>(null);

  // Mismo patrón, para el detalle expandible del reporte de Clientes.
  const [clienteExpandidoId, setClienteExpandidoId] = useState<number | null>(null);
  const [detalleCliente, setDetalleCliente] = useState<Record<number, any[]>>({});
  const [cargandoDetalleClienteId, setCargandoDetalleClienteId] = useState<number | null>(null);

  // Y también para Sucursales, que antes no tenía detalle expandible.
  const [sucursalExpandidoId, setSucursalExpandidoId] = useState<number | null>(null);
  const [detalleSucursal, setDetalleSucursal] = useState<Record<number, any[]>>({});
  const [cargandoDetalleSucursalId, setCargandoDetalleSucursalId] = useState<number | null>(null);

  // Cuando se da clic en el número de "Actas pendientes" (en vez de en la
  // fila completa), se abre el mismo detalle pero filtrado a solo esos
  // procesos, para ir directo a lo que falta subir sin tener que leer toda
  // la lista.
  const [soloPendientesDetalle, setSoloPendientesDetalle] = useState(false);

  const esActaPendiente = (p: any) => p.estado === 'cerrado_con_acuerdo' && !p.finalizado;

  useEffect(() => {
    // Productividad y Sucursales son solo para el administrador; si por
    // alguna razón un mediador quedara en uno de esos tipos, se regresa al
    // primero.
    if (!admin && (tipo === 'productividad' || tipo === 'sucursales')) {
      setTipo('procesos');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  useEffect(() => {
    getSucursalesCached().then(setSucursales).catch(() => setSucursales([]));
    getCiudadesCached(true).then(setCiudades).catch(() => setCiudades([]));

    if (admin) {
      getUsuarios()
        .then((data) =>
          // El admin también puede mediar sus propios procesos, así que
          // si tiene sucursal asignada debe poder elegirse en este filtro
          // igual que cualquier mediador.
          setMediadores(
            data.filter(
              (u: any) => (u.rol === 'mediador' || u.rol === 'administrador') && u.activo
            )
          )
        )
        .catch(() => setMediadores([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtrosActivos = {
    fecha_desde: filters.fecha_desde || undefined,
    fecha_hasta: filters.fecha_hasta || undefined,
    ciudad_id: filters.ciudad_id || undefined,
    sucursal_id: filters.sucursal_id || undefined,
    usuario_id: filters.usuario_id || undefined
  };

  // Para los reportes operativos: "sin avance" no usa fechas sino un mínimo
  // de días; "actas pendientes" tampoco usa fechas (es una foto de hoy).
  const filtrosOperativo =
    tipo === 'sin-avance'
      ? { ...filtrosActivos, fecha_desde: undefined, fecha_hasta: undefined, dias_minimo: diasMinimo || '7' }
      : tipo === 'actas-pendientes'
      ? { ...filtrosActivos, fecha_desde: undefined, fecha_hasta: undefined }
      : filtrosActivos;

  const buscar = async () => {
    setLoading(true);
    setError('');
    setBuscado(true);

    try {
      let data: any[] = [];

      if (tipo === 'procesos') {
        data = await getProcesos(filtrosActivos);
        getReporteResumen(filtrosActivos)
          .then(setResumenIndicadores)
          .catch(() => setResumenIndicadores(null));
      } else if (tipo === 'productividad') {
        data = await getReporteProductividad(filtrosActivos);
      } else if (tipo === 'sucursales') {
        data = await getReporteSucursales(filtrosActivos);
      } else if (tipo === 'clientes') {
        data = await getReporteClientes(filtrosActivos);
      } else if (esOperativo) {
        data = await getReporteOperativo(tipo as 'agenda' | 'sin-avance' | 'actas-pendientes', filtrosOperativo);
      } else {
        data = await getActasFinales(filtrosActivos);
      }

      setDatos(data);
    } catch {
      setError('No se pudo generar el reporte. Intenta de nuevo.');
      setDatos([]);
    } finally {
      setLoading(false);
    }
  };

  const cambiarTipo = (nuevoTipo: TipoReporte) => {
    setTipo(nuevoTipo);
    setDatos([]);
    setBuscado(false);
    setError('');
    setMediadorExpandidoId(null);
    setClienteExpandidoId(null);
    setSucursalExpandidoId(null);
    setSoloPendientesDetalle(false);
  };

  // Abre el proceso en una pestaña nueva para no perder el reporte ya
  // generado (con sus filtros) en esta pestaña.
  const abrirProceso = (procesoId: number) => {
    window.open(`/procesos/${procesoId}`, '_blank');
  };

  const toggleDetalleMediador = async (mediadorId: number, soloPendientes = false) => {
    if (mediadorExpandidoId === mediadorId && !soloPendientes) {
      setMediadorExpandidoId(null);
      setSoloPendientesDetalle(false);
      return;
    }

    setMediadorExpandidoId(mediadorId);
    setSoloPendientesDetalle(soloPendientes);

    if (detalleProcesos[mediadorId]) return;

    setCargandoDetalleId(mediadorId);

    try {
      const data = await getProcesos({
        usuario_id: mediadorId,
        fecha_desde: filtrosActivos.fecha_desde,
        fecha_hasta: filtrosActivos.fecha_hasta
      });

      setDetalleProcesos((prev) => ({ ...prev, [mediadorId]: data }));
    } catch {
      setDetalleProcesos((prev) => ({ ...prev, [mediadorId]: [] }));
    } finally {
      setCargandoDetalleId(null);
    }
  };

  const toggleDetalleCliente = async (clienteId: number, soloPendientes = false) => {
    if (clienteExpandidoId === clienteId && !soloPendientes) {
      setClienteExpandidoId(null);
      setSoloPendientesDetalle(false);
      return;
    }

    setClienteExpandidoId(clienteId);
    setSoloPendientesDetalle(soloPendientes);

    if (detalleCliente[clienteId]) return;

    setCargandoDetalleClienteId(clienteId);

    try {
      const data = await getProcesos({
        cliente_id: clienteId,
        fecha_desde: filtrosActivos.fecha_desde,
        fecha_hasta: filtrosActivos.fecha_hasta
      });

      setDetalleCliente((prev) => ({ ...prev, [clienteId]: data }));
    } catch {
      setDetalleCliente((prev) => ({ ...prev, [clienteId]: [] }));
    } finally {
      setCargandoDetalleClienteId(null);
    }
  };

  const toggleDetalleSucursal = async (sucursalId: number, soloPendientes = false) => {
    if (sucursalExpandidoId === sucursalId && !soloPendientes) {
      setSucursalExpandidoId(null);
      setSoloPendientesDetalle(false);
      return;
    }

    setSucursalExpandidoId(sucursalId);
    setSoloPendientesDetalle(soloPendientes);

    if (detalleSucursal[sucursalId]) return;

    setCargandoDetalleSucursalId(sucursalId);

    try {
      const data = await getProcesos({
        sucursal_id: sucursalId,
        fecha_desde: filtrosActivos.fecha_desde,
        fecha_hasta: filtrosActivos.fecha_hasta
      });

      setDetalleSucursal((prev) => ({ ...prev, [sucursalId]: data }));
    } catch {
      setDetalleSucursal((prev) => ({ ...prev, [sucursalId]: [] }));
    } finally {
      setCargandoDetalleSucursalId(null);
    }
  };

  const handleExportarExcel = async () => {
    setExportando(true);
    setError('');

    try {
      const blob = await descargarReporteExcel(tipo, filtrosOperativo);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = `reporte_${tipo}_numa.xlsx`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar el Excel. Intenta de nuevo.');
    } finally {
      setExportando(false);
    }
  };

  const handleImprimir = () => {
    const params = new URLSearchParams();
    params.set('tipo', tipo);

    Object.entries(filtrosOperativo).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });

    window.open(`/reportes/imprimir?${params.toString()}`, '_blank');
  };

  // Resumen rápido arriba de la tabla: para procesos, cuántos hay en cada
  // estado (y cuántos de los "con acuerdo" todavía no tienen su acta final
  // subida, para que no se confunda "cerrado" con "ya está el acta").
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

  // El sistema gira ante todo en torno a las actas, así que ese gráfico va
  // primero, antes que el de procesos por estado/mediador/sucursal — no al
  // revés.
  //
  // En Procesos, es un solo gráfico con 2 barras (subidas vs pendientes).
  // En Equipo/Sucursales, es un listado por mediador/sucursal, igual que ya
  // existía para "pendientes" — ahora con su contraparte "completas".
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

  // Barritas para que los reportes no sean solo números: por estado en
  // Procesos, por mediador en Equipo, por sucursal en Sucursales. En
  // Actas/Clientes no aporta tanto (muchas filas de a 1), así que se deja
  // solo la tabla.
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

  // Actas pendientes por mediador/sucursal (Procesos ya las muestra dentro
  // de "barrasActas" arriba, así que acá solo aplica a Equipo/Sucursales).
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

  return (
    <>
      <PageHeader
        title="Reportes"
        subtitle="Consulta y exporta la información del sistema por periodo"
      />

      {error && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}

      {/* Selector de tipo de reporte */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {tiposVisibles.map((t) => (
          <button
            key={t.valor}
            type="button"
            onClick={() => cambiarTipo(t.valor)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              tipo === t.valor
                ? 'bg-gold-400 text-numa-950 shadow-sm'
                : 'bg-white border border-numa-200 text-numa-600 hover:border-gold-400 hover:text-gold-600'
            }`}
          >
            {t.titulo}
          </button>
        ))}
      </div>

      <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-sm p-3 mb-4">
        <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700">{DESCRIPCIONES[tipo]}</p>
      </div>

      <div className="card p-4 mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            buscar();
          }}
        >
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          {tipo !== 'sin-avance' && tipo !== 'actas-pendientes' && (
            <>
              <InputField
                label="Fecha desde"
                type="date"
                value={filters.fecha_desde}
                onChange={(e) => setFilters({ ...filters, fecha_desde: e.target.value })}
              />

              <InputField
                label="Fecha hasta"
                type="date"
                value={filters.fecha_hasta}
                onChange={(e) => setFilters({ ...filters, fecha_hasta: e.target.value })}
              />
            </>
          )}

          {tipo === 'sin-avance' && (
            <InputField
              label="Mínimo de días sin avance"
              type="number"
              min={0}
              value={diasMinimo}
              onChange={(e) => setDiasMinimo(e.target.value)}
            />
          )}

          {admin && (
            <SelectField
              label="Ciudad"
              value={filters.ciudad_id}
              onChange={(e) =>
                setFilters({ ...filters, ciudad_id: e.target.value, sucursal_id: '' })
              }
            >
              <option value="">Todas</option>
              {ciudades.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </SelectField>
          )}

          {admin && (
            <SelectField
              label="Sucursal"
              value={filters.sucursal_id}
              onChange={(e) => setFilters({ ...filters, sucursal_id: e.target.value })}
            >
              <option value="">Todas</option>
              {sucursales
                .filter((s: any) =>
                  filters.ciudad_id ? String(s.ciudad_id) === String(filters.ciudad_id) : true
                )
                .map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
            </SelectField>
          )}

          {admin && (
            <SelectField
              label="Mediador"
              value={filters.usuario_id}
              onChange={(e) => setFilters({ ...filters, usuario_id: e.target.value })}
            >
              <option value="">Todos</option>
              {mediadores.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.nombre} {m.apellido}
                </option>
              ))}
            </SelectField>
          )}
        </div>

        <div className="flex flex-wrap gap-3 mt-4">
          <button type="submit" className="btn-primary">
            <Search className="w-4 h-4" />
            Generar reporte
          </button>

          {buscado && datos.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportarExcel}
                disabled={exportando}
                className="btn-secondary"
              >
                <FileSpreadsheet className="w-4 h-4" />
                {exportando ? 'Descargando...' : 'Descargar Excel'}
              </button>

              <button type="button" onClick={handleImprimir} className="btn-secondary">
                <Printer className="w-4 h-4" />
                Imprimir / PDF
              </button>
            </>
          )}
        </div>
        </form>
      </div>

      {loading ? (
        <Spinner />
      ) : !buscado ? (
        <div className="card p-6">
          <EmptyState message="Elige un tipo de reporte, ajusta los filtros y da clic en &quot;Generar reporte&quot;." />
        </div>
      ) : datos.length === 0 ? (
        <div className="card p-6">
          <EmptyState message="No hay resultados con esos filtros." />
        </div>
      ) : (
        <div className="space-y-4">
          {tipo === 'procesos' && resumenProcesos && (
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="px-3 py-1.5 rounded-full bg-numa-100 text-numa-700 font-medium">
                {datos.length} en total
              </span>
              {Object.entries(resumenProcesos).map(([estado, cantidad]) => (
                <span
                  key={estado}
                  className="px-3 py-1.5 rounded-full bg-numa-50 text-numa-600 border border-numa-200"
                >
                  {getEstadoLabel(estado)}: <strong>{cantidad as number}</strong>
                </span>
              ))}
              {actasPendientesProcesos > 0 && (
                <span className="px-3 py-1.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-medium">
                  Con acuerdo sin acta subida: <strong>{actasPendientesProcesos}</strong>
                </span>
              )}

              {resumenIndicadores && resumenIndicadores.tasa_acuerdo !== null && (
                <span
                  className="px-3 py-1.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium"
                  title={`De ${resumenIndicadores.total_resueltos} procesos resueltos (con o sin acuerdo), ${resumenIndicadores.cerrados_con_acuerdo} terminaron con acuerdo.`}
                >
                  Tasa de acuerdo: <strong>{resumenIndicadores.tasa_acuerdo}%</strong>
                </span>
              )}

              {resumenIndicadores && resumenIndicadores.promedio_dias_resolucion !== null && (
                <span className="px-3 py-1.5 rounded-full bg-numa-50 text-numa-600 border border-numa-200">
                  Tiempo promedio de resolución:{' '}
                  <strong>{resumenIndicadores.promedio_dias_resolucion} días</strong>
                </span>
              )}
            </div>
          )}

          {tipo !== 'procesos' && (
            <div className="text-sm text-numa-500">
              Mostrando <span className="font-semibold text-numa-800">{datos.length}</span>{' '}
              {tipo === 'productividad' &&
                (datos.length === 1 ? 'mediador' : 'mediadores')}
              {tipo === 'sucursales' &&
                (datos.length === 1 ? 'sucursal' : 'sucursales')}
              {tipo === 'clientes' &&
                (datos.length === 1 ? 'cliente' : 'clientes')}
              {tipo === 'actas' &&
                (datos.length === 1 ? 'acta final' : 'actas finales')}
            </div>
          )}

          {/* El gráfico de actas va primero: es el corazón del sistema,
              antes que el desglose general de procesos. */}
          {barrasActas && barrasActas.length > 0 && (
            <div className="card p-4">
              <p className="text-xs font-medium text-numa-500 mb-3 uppercase tracking-wide">
                {tipo === 'procesos'
                  ? 'Actas'
                  : 'Actas subidas por ' + (tipo === 'productividad' ? 'mediador' : 'sucursal')}
              </p>
              <BarrasResumen items={barrasActas} />
            </div>
          )}

          {barrasResumen && barrasResumen.length > 0 && (
            <div className="card p-4">
              <p className="text-xs font-medium text-numa-500 mb-3 uppercase tracking-wide">
                {tipo === 'procesos' ? 'Por estado' : 'Procesos por ' + (tipo === 'productividad' ? 'mediador' : 'sucursal')}
              </p>
              <BarrasResumen items={barrasResumen} />
            </div>
          )}

          {barrasActasPendientes && barrasActasPendientes.length > 0 && (
            <div className="card p-4 border-red-200">
              <p className="text-xs font-medium text-red-600 mb-3 uppercase tracking-wide">
                Actas pendientes de subir por {tipo === 'productividad' ? 'mediador' : 'sucursal'}
              </p>
              <BarrasResumen items={barrasActasPendientes} />
            </div>
          )}

          <div className="card overflow-hidden">
            {/* La tabla tiene su propio alto máximo: así la barra de desplazamiento
                horizontal queda siempre visible al pie de la ventana (no al final
                de toda la lista), y los encabezados se quedan fijos arriba. */}
            <div className="overflow-auto max-h-[70vh] tabla-compacta">
              <table className="min-w-full">
                <thead className="bg-numa-50 border-b border-numa-100 sticky top-0 z-10 [&_th]:bg-numa-50">
                  <tr>
                    {tipo === 'procesos' && (
                      <>
                        <th className="table-header">Código</th>
                        <th className="table-header">Estado</th>
                        <th className="table-header">Acta final</th>
                        <th className="table-header">Solicitante</th>
                        <th className="table-header">Invitado</th>
                        <th className="table-header">Ciudad</th>
                        <th className="table-header">Sucursal</th>
                        {admin && <th className="table-header">Mediador</th>}
                        <th className="table-header">Tema</th>
                        <th className="table-header">Fecha</th>
                      </>
                    )}

                    {tipo === 'productividad' && (
                      <>
                        <th className="table-header"></th>
                        <th className="table-header">Mediador</th>
                        <th className="table-header">Estado</th>
                        <th className="table-header">Fecha ingreso</th>
                        <th className="table-header">Ciudad</th>
                        <th className="table-header">Sucursal</th>
                        <th className="table-header">Total</th>
                        <th className="table-header">En negociación</th>
                        <th className="table-header">Con acuerdo</th>
                        <th className="table-header">Sin acuerdo</th>
                        <th className="table-header">Archivados</th>
                        <th className="table-header">Anulados</th>
                        <th className="table-header">Actas subidas</th>
                        <th className="table-header">Actas pendientes</th>
                        <th className="table-header">Prom. días cierre</th>
                      </>
                    )}

                    {tipo === 'actas' && (
                      <>
                        <th className="table-header">Código de acta</th>
                        <th className="table-header">Proceso</th>
                        <th className="table-header">Solicitante</th>
                        <th className="table-header">Invitado</th>
                        <th className="table-header">Ciudad</th>
                        <th className="table-header">Sucursal</th>
                        {admin && <th className="table-header">Mediador</th>}
                        <th className="table-header">Fecha de subida</th>
                      </>
                    )}

                    {tipo === 'sucursales' && (
                      <>
                        <th className="table-header"></th>
                        <th className="table-header">Sucursal</th>
                        <th className="table-header">Ciudad</th>
                        <th className="table-header">Total</th>
                        <th className="table-header">En negociación</th>
                        <th className="table-header">Con acuerdo</th>
                        <th className="table-header">Sin acuerdo</th>
                        <th className="table-header">Archivados</th>
                        <th className="table-header">Anulados</th>
                        <th className="table-header">Actas subidas</th>
                        <th className="table-header">Actas pendientes</th>
                        <th className="table-header">Prom. días cierre</th>
                      </>
                    )}

                    {tipo === 'clientes' && (
                      <>
                        <th className="table-header"></th>
                        <th className="table-header">Cliente</th>
                        <th className="table-header">Cédula</th>
                        <th className="table-header">Teléfono</th>
                        <th className="table-header">Email</th>
                        <th className="table-header">Total</th>
                        <th className="table-header">En negociación</th>
                        <th className="table-header">Con acuerdo</th>
                        <th className="table-header">Sin acuerdo</th>
                        <th className="table-header">Archivados</th>
                        <th className="table-header">Anulados</th>
                        <th className="table-header">Actas subidas</th>
                        <th className="table-header">Actas pendientes</th>
                        <th className="table-header">Procesos (códigos)</th>
                        <th className="table-header">Actas (códigos)</th>
                      </>
                    )}
                    {tipo === 'agenda' && (
                      <>
                        <th className="table-header">Fecha</th>
                        <th className="table-header">Hora</th>
                        <th className="table-header">Proceso</th>
                        <th className="table-header">Solicitante</th>
                        <th className="table-header">Invitado</th>
                        {admin && <th className="table-header">Mediador</th>}
                        <th className="table-header">Sucursal</th>
                        <th className="table-header">Estado</th>
                      </>
                    )}

                    {tipo === 'sin-avance' && (
                      <>
                        <th className="table-header">Proceso</th>
                        <th className="table-header">Solicitante</th>
                        <th className="table-header">Invitado</th>
                        {admin && <th className="table-header">Mediador</th>}
                        <th className="table-header">Sucursal</th>
                        <th className="table-header">Último avance</th>
                        <th className="table-header">Avances</th>
                        <th className="table-header">Días sin avance</th>
                      </>
                    )}

                    {tipo === 'actas-pendientes' && (
                      <>
                        <th className="table-header">Proceso</th>
                        <th className="table-header">Solicitante</th>
                        <th className="table-header">Invitado</th>
                        {admin && <th className="table-header">Mediador</th>}
                        <th className="table-header">Sucursal</th>
                        <th className="table-header">Fecha del acuerdo</th>
                        <th className="table-header">Tiempo transcurrido</th>
                        <th className="table-header">Plazo de 48 h</th>
                      </>
                    )}
                  </tr>
                </thead>

                <tbody>
                  {tipo === 'agenda' &&
                    datos.map((c: any) => (
                      <tr
                        key={c.id}
                        onClick={() => c.proceso_id && window.open(`/procesos/${c.proceso_id}`, '_blank')}
                        className="table-row cursor-pointer hover:bg-gold-400/[0.06]"
                      >
                        <td className="table-cell">{formatoFecha(c.fecha)}</td>
                        <td className="table-cell">{String(c.hora).slice(0, 5)}</td>
                        <td className="table-cell font-medium">{c.codigo_proceso}</td>
                        <td className="table-cell">{c.demandante}</td>
                        <td className="table-cell">{c.demandado}</td>
                        {admin && <td className="table-cell">{c.mediador}</td>}
                        <td className="table-cell">{labelSucursal(c)}</td>
                        <td className="table-cell">
                          {c.atrasada ? (
                            <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-xs font-medium">
                              Atrasada
                            </span>
                          ) : (
                            ETIQUETAS_CITA[c.estado] || c.estado
                          )}
                        </td>
                      </tr>
                    ))}

                  {tipo === 'sin-avance' &&
                    datos.map((p: any) => (
                      <tr
                        key={p.id}
                        onClick={() => abrirProceso(p.id)}
                        className="table-row cursor-pointer hover:bg-gold-400/[0.06]"
                      >
                        <td className="table-cell font-medium">{p.codigo_proceso}</td>
                        <td className="table-cell">{p.demandante}</td>
                        <td className="table-cell">{p.demandado}</td>
                        {admin && <td className="table-cell">{p.mediador}</td>}
                        <td className="table-cell">{labelSucursal(p)}</td>
                        <td className="table-cell">
                          {p.ultimo_avance ? formatoFecha(p.ultimo_avance) : 'Ninguno'}
                        </td>
                        <td className="table-cell">{p.total_avances}</td>
                        <td className="table-cell">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              p.dias_sin_avance >= 30
                                ? 'bg-red-50 text-red-700'
                                : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {p.dias_sin_avance} {p.dias_sin_avance === 1 ? 'día' : 'días'}
                          </span>
                        </td>
                      </tr>
                    ))}

                  {tipo === 'actas-pendientes' &&
                    datos.map((p: any) => (
                      <tr
                        key={p.id}
                        onClick={() => abrirProceso(p.id)}
                        className="table-row cursor-pointer hover:bg-gold-400/[0.06]"
                      >
                        <td className="table-cell font-medium">{p.codigo_proceso}</td>
                        <td className="table-cell">{p.demandante}</td>
                        <td className="table-cell">{p.demandado}</td>
                        {admin && <td className="table-cell">{p.mediador}</td>}
                        <td className="table-cell">{labelSucursal(p)}</td>
                        <td className="table-cell">{formatoFecha(p.fecha_acuerdo)}</td>
                        <td className="table-cell">
                          {p.horas_transcurridas == null
                            ? '—'
                            : p.horas_transcurridas >= 24
                            ? `${Math.floor(p.horas_transcurridas / 24)} d ${p.horas_transcurridas % 24} h`
                            : `${p.horas_transcurridas} h`}
                        </td>
                        <td className="table-cell">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              p.plazo_vencido ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                            }`}
                          >
                            {p.plazo_vencido ? 'Vencido' : 'En plazo'}
                          </span>
                        </td>
                      </tr>
                    ))}

                  {tipo === 'procesos' &&
                    datos.map((p: any) => (
                      <tr
                        key={p.id}
                        onClick={() => abrirProceso(p.id)}
                        className="table-row cursor-pointer hover:bg-gold-400/[0.06]"
                      >
                        <td className="table-cell font-medium">{p.codigo_proceso}</td>
                        <td className="table-cell">{getEstadoLabel(p.estado)}</td>
                        <td className="table-cell">
                          {p.estado === 'cerrado_con_acuerdo' && !p.finalizado ? (
                            <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-xs font-medium">
                              Pendiente
                            </span>
                          ) : p.finalizado ? (
                            <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                              Subida
                            </span>
                          ) : (
                            <span className="text-numa-300">—</span>
                          )}
                        </td>
                        <td className="table-cell">{p.demandante}</td>
                        <td className="table-cell">{p.demandado}</td>
                        <td className="table-cell">{p.ciudad || '—'}</td>
                        <td className="table-cell">{p.sucursal ? labelSucursal(p) : "—"}</td>
                        {admin && (
                          <td className="table-cell max-w-[170px] truncate" title={p.usuario}>
                            {p.usuario || '—'}
                          </td>
                        )}
                        <td className="table-cell max-w-[200px] truncate" title={p.tema}>{p.tema}</td>
                        <td className="table-cell">
                          {p.fecha_creacion
                            ? new Date(p.fecha_creacion).toLocaleDateString('es-EC')
                            : '—'}
                        </td>
                      </tr>
                    ))}

                  {tipo === 'productividad' &&
                    datos.map((m: any) => (
                      <Fragment key={m.usuario_id}>
                        <tr
                          onClick={() => toggleDetalleMediador(m.usuario_id)}
                          className="table-row cursor-pointer hover:bg-gold-400/[0.06]"
                        >
                          <td className="table-cell w-6">
                            {mediadorExpandidoId === m.usuario_id ? (
                              <ChevronDown className="w-4 h-4 text-numa-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-numa-400" />
                            )}
                          </td>
                          <td className="table-cell font-medium">{m.mediador}</td>
                          <td className="table-cell">
                            <Badge label={m.activo ? 'Activo' : 'Inactivo'} variant={m.activo ? 'activo' : 'inactivo'} />
                          </td>
                          <td className="table-cell">
                            {m.fecha_ingreso
                              ? new Date(m.fecha_ingreso).toLocaleDateString('es-EC')
                              : '—'}
                          </td>
                          <td className="table-cell">{m.ciudad || '—'}</td>
                          <td className="table-cell">{m.sucursal ? labelSucursal(m) : "—"}</td>
                          <td className="table-cell">{m.total_procesos}</td>
                          <td className="table-cell">{m.en_negociacion}</td>
                          <td className="table-cell">{m.cerrados_con_acuerdo}</td>
                          <td className="table-cell">{m.cerrados_sin_acuerdo}</td>
                          <td className="table-cell">{m.archivados}</td>
                          <td className="table-cell">{m.anulados}</td>
                          <td className="table-cell">{m.actas_subidas}</td>
                          <td className="table-cell">
                            {m.actas_pendientes > 0 ? (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleDetalleMediador(m.usuario_id, true);
                                }}
                                className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-xs font-medium cursor-pointer hover:bg-red-100 underline decoration-dotted"
                                title="Ver los procesos con acta pendiente"
                              >
                                {m.actas_pendientes}
                              </span>
                            ) : (
                              0
                            )}
                          </td>
                          <td className="table-cell">
                            {m.promedio_dias_cierre != null
                              ? `${m.promedio_dias_cierre} días`
                              : '—'}
                          </td>
                        </tr>

                        {mediadorExpandidoId === m.usuario_id && (
                          <tr key={`${m.usuario_id}-detalle`}>
                            <td colSpan={14} className="bg-numa-50 px-4 py-4">
                              {cargandoDetalleId === m.usuario_id ? (
                                <Spinner />
                              ) : !detalleProcesos[m.usuario_id]?.length ? (
                                <p className="text-xs text-numa-400 py-2">
                                  Este mediador no tiene procesos en este rango de fechas.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between flex-wrap gap-2">
                                    <p className="text-xs text-numa-500 font-medium">
                                      {soloPendientesDetalle
                                        ? `Procesos de ${m.mediador} con acta pendiente:`
                                        : `Procesos de ${m.mediador} en este periodo:`}
                                    </p>
                                    {soloPendientesDetalle && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSoloPendientesDetalle(false);
                                        }}
                                        className="text-xs text-numa-500 underline hover:text-numa-800"
                                      >
                                        Ver todos
                                      </button>
                                    )}
                                  </div>

                                  {(soloPendientesDetalle
                                    ? detalleProcesos[m.usuario_id].filter(esActaPendiente)
                                    : detalleProcesos[m.usuario_id]
                                  ).map((p: any) => (
                                    <div
                                      key={p.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        abrirProceso(p.id);
                                      }}
                                      className="bg-white border border-numa-200 rounded-sm p-3 cursor-pointer hover:shadow-md transition-shadow duration-200 flex items-center justify-between gap-3 flex-wrap"
                                    >
                                      <div>
                                        <span className="font-medium text-numa-800 code-text text-xs">
                                          {p.codigo_proceso}
                                        </span>
                                        <span className="text-xs text-numa-600 ml-2">
                                          {p.demandante} vs {p.demandado}
                                        </span>
                                      </div>

                                      <span className="text-xs text-numa-500">
                                        {getEstadoLabel(p.estado)} ·{' '}
                                        {p.fecha_creacion
                                          ? new Date(p.fecha_creacion).toLocaleDateString('es-EC')
                                          : '—'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}

                  {tipo === 'actas' &&
                    datos.map((a: any) => (
                      <tr
                        key={a.id}
                        onClick={() => abrirProceso(a.proceso_id)}
                        className="table-row cursor-pointer hover:bg-gold-400/[0.06]"
                      >
                        <td className="table-cell font-medium">{a.codigo_acta}</td>
                        <td className="table-cell">{a.codigo_proceso}</td>
                        <td className="table-cell">{a.demandante}</td>
                        <td className="table-cell">{a.demandado}</td>
                        <td className="table-cell">{a.ciudad || '—'}</td>
                        <td className="table-cell">{a.sucursal ? labelSucursal(a) : "—"}</td>
                        {admin && <td className="table-cell">{a.usuario || '—'}</td>}
                        <td className="table-cell">
                          {a.fecha_subida
                            ? new Date(a.fecha_subida).toLocaleDateString('es-EC')
                            : '—'}
                        </td>
                      </tr>
                    ))}

                  {tipo === 'sucursales' &&
                    datos.map((s: any) => (
                      <Fragment key={s.sucursal_id}>
                        <tr
                          onClick={() => toggleDetalleSucursal(s.sucursal_id)}
                          className="table-row cursor-pointer hover:bg-gold-400/[0.06]"
                        >
                          <td className="table-cell w-6">
                            {sucursalExpandidoId === s.sucursal_id ? (
                              <ChevronDown className="w-4 h-4 text-numa-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-numa-400" />
                            )}
                          </td>
                          <td className="table-cell font-medium">{s.sucursal}</td>
                          <td className="table-cell">{s.ciudad || '—'}</td>
                          <td className="table-cell">{s.total_procesos}</td>
                          <td className="table-cell">{s.en_negociacion}</td>
                          <td className="table-cell">{s.cerrados_con_acuerdo}</td>
                          <td className="table-cell">{s.cerrados_sin_acuerdo}</td>
                          <td className="table-cell">{s.archivados}</td>
                          <td className="table-cell">{s.anulados}</td>
                          <td className="table-cell">{s.actas_subidas}</td>
                          <td className="table-cell">
                            {s.actas_pendientes > 0 ? (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleDetalleSucursal(s.sucursal_id, true);
                                }}
                                className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-xs font-medium cursor-pointer hover:bg-red-100 underline decoration-dotted"
                                title="Ver los procesos con acta pendiente"
                              >
                                {s.actas_pendientes}
                              </span>
                            ) : (
                              0
                            )}
                          </td>
                          <td className="table-cell">
                            {s.promedio_dias_cierre != null
                              ? `${s.promedio_dias_cierre} días`
                              : '—'}
                          </td>
                        </tr>

                        {sucursalExpandidoId === s.sucursal_id && (
                          <tr key={`${s.sucursal_id}-detalle`}>
                            <td colSpan={12} className="bg-numa-50 px-4 py-4">
                              {cargandoDetalleSucursalId === s.sucursal_id ? (
                                <Spinner />
                              ) : !detalleSucursal[s.sucursal_id]?.length ? (
                                <p className="text-xs text-numa-400 py-2">
                                  Esta sucursal no tiene procesos en este rango de fechas.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between flex-wrap gap-2">
                                    <p className="text-xs text-numa-500 font-medium">
                                      {soloPendientesDetalle
                                        ? `Procesos de ${s.sucursal} con acta pendiente:`
                                        : `Procesos de ${s.sucursal} en este periodo:`}
                                    </p>
                                    {soloPendientesDetalle && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSoloPendientesDetalle(false);
                                        }}
                                        className="text-xs text-numa-500 underline hover:text-numa-800"
                                      >
                                        Ver todos
                                      </button>
                                    )}
                                  </div>

                                  {(soloPendientesDetalle
                                    ? detalleSucursal[s.sucursal_id].filter(esActaPendiente)
                                    : detalleSucursal[s.sucursal_id]
                                  ).map((p: any) => (
                                    <div
                                      key={p.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        abrirProceso(p.id);
                                      }}
                                      className="bg-white border border-numa-200 rounded-sm p-3 cursor-pointer hover:shadow-md transition-shadow duration-200 flex items-center justify-between gap-3 flex-wrap"
                                    >
                                      <div>
                                        <span className="font-medium text-numa-800 code-text text-xs">
                                          {p.codigo_proceso}
                                        </span>
                                        <span className="text-xs text-numa-600 ml-2">
                                          {p.demandante} vs {p.demandado}
                                        </span>
                                      </div>

                                      <span className="text-xs text-numa-500">
                                        {getEstadoLabel(p.estado)} ·{' '}
                                        {p.fecha_creacion
                                          ? new Date(p.fecha_creacion).toLocaleDateString('es-EC')
                                          : '—'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}

                  {tipo === 'clientes' &&
                    datos.map((c: any) => (
                      <Fragment key={c.cliente_id}>
                        <tr
                          onClick={() => toggleDetalleCliente(c.cliente_id)}
                          className="table-row cursor-pointer hover:bg-gold-400/[0.06]"
                        >
                          <td className="table-cell w-6">
                            {clienteExpandidoId === c.cliente_id ? (
                              <ChevronDown className="w-4 h-4 text-numa-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-numa-400" />
                            )}
                          </td>
                          <td className="table-cell font-medium">{c.cliente}</td>
                          <td className="table-cell">{c.cedula || '—'}</td>
                          <td className="table-cell">{c.telefono || '—'}</td>
                          <td className="table-cell">{c.email || '—'}</td>
                          <td className="table-cell">{c.total_procesos}</td>
                          <td className="table-cell">{c.en_negociacion}</td>
                          <td className="table-cell">{c.cerrados_con_acuerdo}</td>
                          <td className="table-cell">{c.cerrados_sin_acuerdo}</td>
                          <td className="table-cell">{c.archivados}</td>
                          <td className="table-cell">{c.anulados}</td>
                          <td className="table-cell">{c.actas_subidas}</td>
                          <td className="table-cell">
                            {c.actas_pendientes > 0 ? (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleDetalleCliente(c.cliente_id, true);
                                }}
                                className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-xs font-medium cursor-pointer hover:bg-red-100 underline decoration-dotted"
                                title="Ver los procesos con acta pendiente"
                              >
                                {c.actas_pendientes}
                              </span>
                            ) : (
                              0
                            )}
                          </td>
                          <td className="table-cell text-xs code-text min-w-[160px]">
                            {c.codigos_procesos || '—'}
                          </td>
                          <td className="table-cell text-xs code-text min-w-[160px]">
                            {c.codigos_actas || '—'}
                          </td>
                        </tr>

                        {clienteExpandidoId === c.cliente_id && (
                          <tr key={`${c.cliente_id}-detalle`}>
                            <td colSpan={15} className="bg-numa-50 px-4 py-4">
                              {cargandoDetalleClienteId === c.cliente_id ? (
                                <Spinner />
                              ) : !detalleCliente[c.cliente_id]?.length ? (
                                <p className="text-xs text-numa-400 py-2">
                                  Este cliente no tiene procesos en este rango de fechas.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between flex-wrap gap-2">
                                    <p className="text-xs text-numa-500 font-medium">
                                      {soloPendientesDetalle
                                        ? `Procesos de ${c.cliente} con acta pendiente:`
                                        : `Procesos de ${c.cliente} en este periodo:`}
                                    </p>
                                    {soloPendientesDetalle && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSoloPendientesDetalle(false);
                                        }}
                                        className="text-xs text-numa-500 underline hover:text-numa-800"
                                      >
                                        Ver todos
                                      </button>
                                    )}
                                  </div>

                                  {(soloPendientesDetalle
                                    ? detalleCliente[c.cliente_id].filter(esActaPendiente)
                                    : detalleCliente[c.cliente_id]
                                  ).map((p: any) => (
                                    <div
                                      key={p.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        abrirProceso(p.id);
                                      }}
                                      className="bg-white border border-numa-200 rounded-sm p-3 cursor-pointer hover:shadow-md transition-shadow duration-200 flex items-center justify-between gap-3 flex-wrap"
                                    >
                                      <div>
                                        <span className="font-medium text-numa-800 code-text text-xs">
                                          {p.codigo_proceso}
                                        </span>
                                        <span className="text-xs text-numa-600 ml-2">
                                          {p.demandante} vs {p.demandado}
                                        </span>
                                      </div>

                                      <span className="text-xs text-numa-500">
                                        {getEstadoLabel(p.estado)} ·{' '}
                                        {p.fecha_creacion
                                          ? new Date(p.fecha_creacion).toLocaleDateString('es-EC')
                                          : '—'}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
