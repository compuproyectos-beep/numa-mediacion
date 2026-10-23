'use client';

import { Fragment, useEffect, useState } from 'react';
import { ESTADO_COLOR_GRAFICO } from '@/lib/estados';
import { conActa } from '@/lib/actaProceso';
import { mayusInicial } from '@/lib/texto';
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
  | 'actas-pendientes'
  | 'facturas-pendientes';

const TIPOS_OPERATIVOS: TipoReporte[] = ['agenda', 'sin-avance', 'actas-pendientes', 'facturas-pendientes'];

const ETIQUETAS_CITA: Record<string, string> = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  realizada: 'Realizada',
  no_realizada: 'No asistió / no se realizó',
  cancelada: 'Cancelada',
  reagendada: 'Reagendada'
};

// fecha_acuerdo viene en UTC sin zona horaria: se convierte a fecha de Ecuador.
const fechaAcuerdoEC = (v: any) => {
  if (!v) return '—';
  const iso = String(v).replace(' ', 'T');
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-EC', {
    timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit', year: 'numeric'
  });
};

const formatoFecha = (v: any) => {
  if (!v) return '—';
  const [y, m, d] = String(v).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

const TIPOS: { valor: TipoReporte; titulo: string; adminOnly?: boolean }[] = [
  { valor: 'actas', titulo: 'Actas finales' },
  { valor: 'procesos', titulo: 'Procesos' },
  { valor: 'sin-avance', titulo: 'Procesos sin avance' },
  { valor: 'actas-pendientes', titulo: 'Actas pendientes de subir' },
  { valor: 'facturas-pendientes', titulo: 'Facturas pendientes' },
  { valor: 'productividad', titulo: 'Equipo de mediadores', adminOnly: true },
  { valor: 'sucursales', titulo: 'Sucursales', adminOnly: true },
  { valor: 'clientes', titulo: 'Clientes' }
];

// Explicación en palabras simples de qué muestra cada reporte y cómo leer
// sus columnas, para que quien lo use (no solo quien lo programó) entienda
// los números sin tener que preguntar.
const DESCRIPCIONES: Record<TipoReporte, string> = {
  procesos:
    'Resumen básico de los procesos de mediación creados en el rango de fechas elegido, con su estado actual (los suspendidos se cuentan aparte). Da clic en cualquier fila para abrir ese proceso. "Procesos que terminaron en acuerdo" es, de los procesos ya cerrados (con o sin acuerdo; los archivados y anulados no cuentan), qué porcentaje cerró con acuerdo.',
  productividad:
    'El listado del equipo de mediadores (activos e inactivos), con cuántos procesos maneja cada uno y qué tan rápido los resuelve. Las columnas de reuniones cuentan las reuniones del mediador en el rango de fechas (realizadas, canceladas y las que no se realizaron por inasistencia). "Prom. días cierre" es el promedio de días entre que se crea un proceso y se cierra (con o sin acuerdo, o archivado); mientras más bajo, más rápido resuelve. Da clic en un mediador para ver el detalle de sus procesos.',
  actas:
    'Las actas finales de acuerdo y de no acuerdo del rango de fechas elegido: solo cuentan las que ya tienen el acta firmada subida (no basta con subir los documentos del acta). Arriba se ve cuántas son de cada tipo y cómo se reparten por mes, mediador y sucursal. Da clic en cualquier fila para abrir el proceso al que pertenece esa acta.',
  sucursales:
    'Compara cuántos procesos ha manejado cada sucursal, con su desglose por estado y el promedio de días de cierre.',
  clientes:
    'Por cada cliente, cuántos procesos de mediación ha tenido (como solicitante o invitado) y en qué estado están. Da clic en un cliente para ver el detalle de sus procesos.',
  agenda:
    'Las reuniones (invitaciones) programadas en el rango de fechas elegido. Incluye las invitaciones rápidas (marcadas "Sin proceso"). Las marcadas como "Atrasada" ya pasaron y siguen sin resultado registrado. Da clic en una fila para abrir el proceso o la agenda.',
  'sin-avance':
    'Procesos que siguen en negociación y llevan al menos esos días sin que se registre ningún avance. Sirve para saber cuáles se están quedando olvidados. Los días se cuentan desde el último avance (o desde que se creó el proceso, si nunca tuvo uno).',
  'actas-pendientes':
    'Procesos cerrados con acuerdo que aún no están completos: les falta subir la documentación y el comprobante, o el acta firmada (o están suspendidos). Se muestra cuántos días llevan pendientes desde la fecha del acuerdo.',
  'facturas-pendientes':
    'Procesos con el acta firmada ya subida a los que todavía les falta la factura de NUMA al cliente o la factura del mediador a NUMA (solo cuentan las actas firmadas desde que existe esta regla). No bloquea el proceso; sirve para saber a quién cobrarle las facturas. Se muestran los días desde que se subió el acta firmada.'
};

// Un acta cuenta como lista solo cuando ya está subida el acta firmada (si la requiere).
const actaLista = (p: any) =>
  !!p.finalizado && (!p.requiere_acta_firmada || !!p.tiene_acta_firmada);

const COLOR_ESTADO: Record<string, string> = { ...ESTADO_COLOR_GRAFICO, suspendido: '#F43F5E' };

const getEstadoLabel = (estado: string) => {
  const labels: any = {
    en_negociacion: 'En negociación',
    cerrado_con_acuerdo: 'Cerrado con acuerdo',
    cerrado_sin_acuerdo: 'Cerrado sin acuerdo',
    archivado: 'Archivado',
    anulado: 'Anulado',
    suspendido: 'Suspendido'
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

  const [tipo, setTipo] = useState<TipoReporte>('actas');
  const [diasMinimo, setDiasMinimo] = useState('7');
  // Filtro local de la lista de Actas finales: todas, solo de acuerdo o solo de no acuerdo.
  const [filtroTipoActa, setFiltroTipoActa] = useState<'' | 'acuerdo' | 'no_acuerdo'>('');
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

  const esActaPendiente = (p: any) => conActa(p) && !actaLista(p);

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
      : tipo === 'actas-pendientes' || tipo === 'facturas-pendientes'
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
        data = await getReporteOperativo(tipo as 'agenda' | 'sin-avance' | 'actas-pendientes' | 'facturas-pendientes', filtrosOperativo);
      } else {
        // Solo cuentan como emitidas las actas con el acta firmada ya subida
        // (no basta con los documentos del acta).
        data = (await getActasFinales(filtrosActivos)).filter((a: any) => !a.requiere_acta_firmada || a.tiene_acta_firmada);
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
    setFiltroTipoActa('');
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
            // Un proceso suspendido se cuenta aparte (no en "con acuerdo").
            const k = p.suspendido ? 'suspendido' : p.estado;
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        )
      : null;

  const actasPendientesProcesos =
    tipo === 'procesos'
      ? datos.filter((p: any) => conActa(p) && !actaLista(p)).length
      : 0;

  // El sistema gira ante todo en torno a las actas, así que ese gráfico va
  // primero, antes que el de procesos por estado/mediador/sucursal — no al
  // revés.
  //
  // En Procesos, es un solo gráfico con 2 barras (subidas vs pendientes).
  // En Equipo/Sucursales, es un listado por mediador/sucursal, igual que ya
  // existía para "pendientes" — ahora con su contraparte "completas".

  // --- Actas finales: acuerdo vs no acuerdo ---
  const esNoAcuerdo = (a: any) => a.tipo === 'no_acuerdo';
  const actasDeAcuerdo = tipo === 'actas' ? datos.filter((a: any) => !esNoAcuerdo(a)).length : 0;
  const actasNoAcuerdo = tipo === 'actas' ? datos.filter(esNoAcuerdo).length : 0;
  const actasMostradas =
    tipo === 'actas' && filtroTipoActa
      ? datos.filter((a: any) => (filtroTipoActa === 'no_acuerdo' ? esNoAcuerdo(a) : !esNoAcuerdo(a)))
      : datos;

  const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mesDeActa = (v: any) => {
    if (!v) return null;
    const iso = String(v).replace(' ', 'T');
    const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
    if (isNaN(d.getTime())) return null;
    const f = d.toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' }); // YYYY-MM-DD
    return f.slice(0, 7);
  };
  const barrasActasPor = (clave: (a: any) => string | null | undefined) => {
    const m = new Map<string, { a: number; n: number }>();
    datos.forEach((a: any) => {
      const k = clave(a);
      if (!k) return;
      const x = m.get(k) || { a: 0, n: 0 };
      if (esNoAcuerdo(a)) x.n++; else x.a++;
      m.set(k, x);
    });
    return Array.from(m.entries());
  };
  // Cada grupo trae sus barras de "acuerdo" y "no acuerdo" por separado
  // (mismos colores en todos los gráficos: verde = acuerdo, ámbar = no acuerdo).
  // Un nombre por grupo: la barra verde lleva el nombre y la ámbar, debajo,
  // solo "no acuerdo" (así las etiquetas no se cortan).
  const parBarras = (k: string, v: { a: number; n: number }) => {
    const out: { label: string; valor: number; color?: string }[] = [];
    if (v.a > 0) out.push({ label: k, valor: v.a, color: '#10B981' });
    if (v.n > 0) out.push({ label: v.a > 0 ? '   ↳ no acuerdo' : `${k} (no acuerdo)`, valor: v.n, color: '#F59E0B' });
    return out;
  };
  const gruposActas: { titulo: string; items: { label: string; valor: number; color?: string }[] }[] =
    tipo === 'actas'
      ? [
          {
            titulo: 'Acuerdo y no acuerdo',
            items: [
              { label: 'Actas de acuerdo', valor: actasDeAcuerdo, color: '#10B981' },
              { label: 'Actas de no acuerdo', valor: actasNoAcuerdo, color: '#F59E0B' }
            ]
          },
          {
            titulo: 'Actas por mes',
            items: barrasActasPor((a) => mesDeActa(a.fecha_subida))
              .sort((x, y) => x[0].localeCompare(y[0]))
              .flatMap(([k, v]) => {
                const [y, mm] = k.split('-');
                return parBarras(`${MESES_CORTOS[Number(mm) - 1]} ${y}`, v);
              })
          },
          ...(admin
            ? [
                {
                  titulo: 'Actas por mediador',
                  items: barrasActasPor((a) => a.mediador || a.usuario)
                    .sort((x, y) => y[1].a + y[1].n - (x[1].a + x[1].n))
                    .flatMap(([k, v]) => parBarras(k, v))
                },
                {
                  titulo: 'Actas por sucursal',
                  items: barrasActasPor((a) => (a.sucursal ? labelSucursal(a) : null))
                    .sort((x, y) => y[1].a + y[1].n - (x[1].a + x[1].n))
                    .flatMap(([k, v]) => parBarras(k, v))
                }
              ]
            : [])
        ].filter((g) => g.items.length > 0)
      : [];

  const barrasActas: { label: string; valor: number; color?: string }[] | null =
    tipo === 'procesos'
      ? null
      : tipo === 'productividad'
      ? datos.flatMap((m: any) =>
          parBarras(m.mediador, { a: (m.actas_subidas || 0) - (m.actas_no_acuerdo || 0), n: m.actas_no_acuerdo || 0 })
        )
      : tipo === 'sucursales'
      ? datos.flatMap((s: any) =>
          parBarras(labelSucursal(s), { a: (s.actas_subidas || 0) - (s.actas_no_acuerdo || 0), n: s.actas_no_acuerdo || 0 })
        )
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
          .map((m: any) => ({ label: m.mediador, valor: m.actas_pendientes, color: '#F59E0B' }))
      : tipo === 'sucursales'
      ? datos
          .filter((s: any) => s.actas_pendientes > 0)
          .map((s: any) => ({ label: labelSucursal(s), valor: s.actas_pendientes, color: '#F59E0B' }))
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
      <div className="flex gap-1.5 mb-3 flex-wrap">
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

      <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-sm p-2.5 mb-3">
        <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700">{DESCRIPCIONES[tipo]}</p>
      </div>

      <div className="card px-3 py-2.5 mb-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            buscar();
          }}
        >
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
          {tipo !== 'sin-avance' && tipo !== 'actas-pendientes' && tipo !== 'facturas-pendientes' && (
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
                    {s.nombre}{(s.ciudad_nombre || s.ciudad) ? ` · ${s.ciudad_nombre || s.ciudad}` : ''}
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
                  {m.nombre} {m.apellido}{m.rol === 'administrador' ? ' (administrador)' : ''}
                </option>
              ))}
            </SelectField>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
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

              {tipo !== 'facturas-pendientes' && (
                <button type="button" onClick={handleImprimir} className="btn-secondary">
                  <Printer className="w-4 h-4" />
                  Imprimir / PDF
                </button>
              )}
            </>
          )}
        </div>
        </form>
      </div>

      {loading ? (
        <Spinner />
      ) : !buscado ? (
        <div className="card px-3 py-2.5">
          <EmptyState message="Elige un tipo de reporte, ajusta los filtros y da clic en &quot;Generar reporte&quot;." />
        </div>
      ) : datos.length === 0 ? (
        <div className="card px-3 py-2.5">
          <EmptyState message="No hay resultados con esos filtros." />
        </div>
      ) : (
        <div className="space-y-3">
          {tipo === 'procesos' && resumenProcesos && (
            <div className="card px-4 py-3 grid gap-4 md:grid-cols-[1.4fr_1fr] md:divide-x md:divide-numa-100">
              <div>
                <p className="text-xs font-semibold text-numa-700 uppercase tracking-wide mb-2">Procesos</p>
                <div className="flex items-end gap-6 flex-wrap">
                  <div>
                    <p className="text-2xl font-bold text-numa-900 leading-none tabular-nums">{datos.length}</p>
                    <p className="text-xs text-numa-700 mt-1">en total</p>
                  </div>
                </div>
              </div>

              <div className="md:pl-5">
                <p className="text-xs font-semibold text-numa-700 uppercase tracking-wide mb-2">Indicadores</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  {resumenIndicadores && resumenIndicadores.tasa_acuerdo !== null && (
                    <div
                      title={`De ${resumenIndicadores.total_resueltos} procesos resueltos (con o sin acuerdo), ${resumenIndicadores.cerrados_con_acuerdo} terminaron con acuerdo.`}
                    >
                      <dt className="text-xs text-numa-700">Procesos que terminaron en acuerdo</dt>
                      <dd className="text-base font-bold text-emerald-700 tabular-nums">
                        {resumenIndicadores.tasa_acuerdo}%{' '}
                        <span className="text-xs font-medium text-numa-700">
                          ({resumenIndicadores.cerrados_con_acuerdo} de {resumenIndicadores.total_resueltos} cerrados)
                        </span>
                      </dd>
                    </div>
                  )}
                  {resumenIndicadores && resumenIndicadores.promedio_dias_resolucion !== null && (
                    <div>
                      <dt className="text-xs text-numa-700">Tiempo promedio de resolución</dt>
                      <dd className="text-base font-bold text-numa-900 tabular-nums">
                        {resumenIndicadores.promedio_dias_resolucion} días
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-numa-700">Con acuerdo sin acta firmada</dt>
                    <dd
                      className={`text-base font-bold tabular-nums ${
                        actasPendientesProcesos > 0 ? 'text-amber-700' : 'text-numa-900'
                      }`}
                    >
                      {actasPendientesProcesos}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          )}

          {tipo === 'actas' && (
            <div className="card px-4 py-3 flex items-end gap-8 flex-wrap">
              <div>
                <p className="text-2xl font-bold text-numa-900 leading-none tabular-nums">{datos.length}</p>
                <p className="text-xs text-numa-700 mt-1">actas finales</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-700 leading-none tabular-nums">{actasDeAcuerdo}</p>
                <p className="text-xs text-numa-700 mt-1">de acuerdo</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-700 leading-none tabular-nums">{actasNoAcuerdo}</p>
                <p className="text-xs text-numa-700 mt-1">de no acuerdo</p>
              </div>
              <div className="ml-auto flex gap-1.5">
                {([['', 'Todas'], ['acuerdo', 'De acuerdo'], ['no_acuerdo', 'De no acuerdo']] as const).map(([v, t]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setFiltroTipoActa(v)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      filtroTipoActa === v
                        ? 'bg-numa-900 text-white'
                        : 'bg-white border border-numa-200 text-numa-600 hover:border-gold-400'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tipo !== 'procesos' && tipo !== 'actas' && (
            <div className="text-[13px] text-numa-700">
              Mostrando <span className="font-semibold text-numa-800">{datos.length}</span>{' '}
              {tipo === 'productividad' &&
                (datos.length === 1 ? 'mediador' : 'mediadores')}
              {tipo === 'sucursales' &&
                (datos.length === 1 ? 'sucursal' : 'sucursales')}
              {tipo === 'clientes' &&
                (datos.length === 1 ? 'cliente' : 'clientes')}
            </div>
          )}

          {((gruposActas.length > 0) ||
            (barrasActas && barrasActas.length > 0) ||
            (barrasResumen && barrasResumen.length > 0) ||
            (barrasActasPendientes && barrasActasPendientes.length > 0)) && (
            <div className="flex items-center gap-3 pt-1">
            <span className="text-[11px] font-bold text-numa-700 uppercase tracking-[0.14em] whitespace-nowrap">Gráficos</span>
            <span className="h-px flex-1 bg-numa-300" aria-hidden="true" />
          </div>
          )}

          {/* El gráfico de actas va primero: es el corazón del sistema,
              antes que el desglose general de procesos. */}
          <div className="grid gap-3 md:grid-cols-2 items-start">
{gruposActas.map((g) => (
            <div key={g.titulo} className="card px-3 py-2.5">
              <p className="text-xs font-semibold text-numa-700 mb-2 uppercase tracking-wide">{g.titulo}</p>
              <BarrasResumen items={g.items} />
            </div>
          ))}
{barrasActas && barrasActas.length > 0 && (
            <div className="card px-3 py-2.5">
              <p className="text-xs font-semibold text-numa-700 mb-2 uppercase tracking-wide">
                {tipo === 'procesos'
                  ? 'Actas'
                  : 'Actas de acuerdo y no acuerdo por ' + (tipo === 'productividad' ? 'mediador' : 'sucursal')}
              </p>
              <BarrasResumen items={barrasActas} />
            </div>
          )}

          {barrasResumen && barrasResumen.length > 0 && (
            <div className="card px-3 py-2.5">
              <p className="text-xs font-semibold text-numa-700 mb-2 uppercase tracking-wide">
                {tipo === 'procesos' ? 'Por estado' : 'Procesos por ' + (tipo === 'productividad' ? 'mediador' : 'sucursal')}
              </p>
              <BarrasResumen items={barrasResumen} />
            </div>
          )}

          {barrasActasPendientes && barrasActasPendientes.length > 0 && (
            <div className="card px-3 py-2.5 border-amber-200">
              <p className="text-xs font-semibold text-amber-700 mb-2 uppercase tracking-wide">
                Actas pendientes de subir por {tipo === 'productividad' ? 'mediador' : 'sucursal'}
              </p>
              <BarrasResumen items={barrasActasPendientes} />
            </div>
          )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <span className="text-[11px] font-bold text-numa-700 uppercase tracking-[0.14em] whitespace-nowrap">Detalle</span>
            <span className="h-px flex-1 bg-numa-300" aria-hidden="true" />
          </div>

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
                        <th className="table-header">Estado</th>
                        <th className="table-header">Acta final</th>
                        <th className="table-header">Solicitante</th>
                        <th className="table-header">Invitado</th>
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
                        <th className="table-header">Total (sin anulados)</th>
                        <th className="table-header">En negociación</th>
                        <th className="table-header">Con acuerdo</th>
                        <th className="table-header">Sin acuerdo</th>
                        <th className="table-header">Archivados</th>
                        <th className="table-header">Anulados</th>
                        <th className="table-header">Actas de acuerdo</th>
                        <th className="table-header">Actas de no acuerdo</th>
                        <th className="table-header">Actas pendientes</th>
                        <th className="table-header">Prom. días cierre</th>
                        <th className="table-header">Reuniones realizadas</th>
                        <th className="table-header">Reuniones canceladas</th>
                        <th className="table-header">No asistieron</th>
                      </>
                    )}

                    {tipo === 'actas' && (
                      <>
                        <th className="table-header">Código de acta</th>
                        <th className="table-header">Tipo</th>
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
                        <th className="table-header">Total (sin anulados)</th>
                        <th className="table-header">En negociación</th>
                        <th className="table-header">Con acuerdo</th>
                        <th className="table-header">Sin acuerdo</th>
                        <th className="table-header">Archivados</th>
                        <th className="table-header">Anulados</th>
                        <th className="table-header">Actas de acuerdo</th>
                        <th className="table-header">Actas de no acuerdo</th>
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
                        <th className="table-header">Total (sin anulados)</th>
                        <th className="table-header">En negociación</th>
                        <th className="table-header">Con acuerdo</th>
                        <th className="table-header">Sin acuerdo</th>
                        <th className="table-header">Archivados</th>
                        <th className="table-header">Anulados</th>
                        <th className="table-header">Actas firmadas</th>
                        <th className="table-header">Actas pendientes</th>
                        <th className="table-header">Procesos (códigos)</th>
                        <th className="table-header">Actas (códigos)</th>
                      </>
                    )}
                    {tipo === 'agenda' && (
                      <>
                        <th className="table-header">Fecha</th>
                        <th className="table-header">Hora</th>
                        <th className="table-header">Solicitante</th>
                        <th className="table-header">Invitado</th>
                        {admin && <th className="table-header">Mediador</th>}
                        <th className="table-header">Sucursal</th>
                        <th className="table-header">Estado</th>
                      </>
                    )}

                    {tipo === 'sin-avance' && (
                      <>
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
                        <th className="table-header">Solicitante</th>
                        <th className="table-header">Invitado</th>
                        {admin && <th className="table-header">Mediador</th>}
                        <th className="table-header">Sucursal</th>
                        <th className="table-header">Fecha del acuerdo</th>
                        <th className="table-header">Estado</th>
                        <th className="table-header">Días pendientes</th>
                      </>
                    )}

                    {tipo === 'facturas-pendientes' && (
                      <>
                        <th className="table-header">Proceso</th>
                        <th className="table-header">Solicitante</th>
                        <th className="table-header">Invitado</th>
                        {admin && <th className="table-header">Mediador</th>}
                        <th className="table-header">Sucursal</th>
                        <th className="table-header">Acta firmada</th>
                        <th className="table-header">Falta</th>
                        <th className="table-header">Días</th>
                      </>
                    )}
                  </tr>
                </thead>

                <tbody>
                  {tipo === 'agenda' &&
                    datos.map((c: any) => (
                      <tr
                        key={c.id}
                        onClick={() =>
                          window.open(
                            c.proceso_id ? `/procesos/${c.proceso_id}` : `/agenda?cita=${c.id}&mediador=${c.mediador_id}`,
                            '_blank'
                          )
                        }
                        className="table-row cursor-pointer hover:bg-gold-400/[0.06]"
                      >
                        <td className="table-cell">
                          {formatoFecha(c.fecha)}
                          {c.sin_proceso && (
                            <span className="ml-2 text-xs font-medium text-numa-600">Sin proceso</span>
                          )}
                        </td>
                        <td className="table-cell">{String(c.hora).slice(0, 5)}</td>
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
                        <td className="table-cell">{p.demandante}</td>
                        <td className="table-cell">{p.demandado}</td>
                        {admin && <td className="table-cell">{p.mediador}</td>}
                        <td className="table-cell">{labelSucursal(p)}</td>
                        <td className="table-cell">{fechaAcuerdoEC(p.fecha_acuerdo)}</td>
                        <td className="table-cell">{p.etapa || '—'}</td>
                        <td className="table-cell">
                          {p.horas_transcurridas == null
                            ? '—'
                            : `${Math.floor(p.horas_transcurridas / 24)} ${Math.floor(p.horas_transcurridas / 24) === 1 ? 'día' : 'días'}`}
                        </td>
                      </tr>
                    ))}

                  {tipo === 'facturas-pendientes' &&
                    datos.map((p: any) => (
                      <tr
                        key={p.id}
                        onClick={() => abrirProceso(p.id)}
                        className="table-row cursor-pointer hover:bg-gold-400/[0.06]"
                      >
                        <td className="table-cell code-text">{p.codigo_proceso}</td>
                        <td className="table-cell">{p.demandante}</td>
                        <td className="table-cell">{p.demandado}</td>
                        {admin && <td className="table-cell">{p.mediador}</td>}
                        <td className="table-cell">{labelSucursal(p)}</td>
                        <td className="table-cell">{fechaAcuerdoEC(p.acta_firmada_fecha)}</td>
                        <td className="table-cell">
                          {[
                            p.falta_cliente ? 'Factura al cliente' : null,
                            p.falta_mediador ? 'Factura del mediador' : null
                          ]
                            .filter(Boolean)
                            .join(' y ')}
                        </td>
                        <td className="table-cell">
                          {p.dias_transcurridos == null
                            ? '—'
                            : `${p.dias_transcurridos} ${p.dias_transcurridos === 1 ? 'día' : 'días'}`}
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
                        <td className="table-cell">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: COLOR_ESTADO[p.estado] || '#94A3B8' }}
                              aria-hidden="true"
                            />
                            {getEstadoLabel(p.suspendido ? 'suspendido' : p.estado)}
                          </span>
                        </td>
                        <td className="table-cell">
                          {conActa(p) && !actaLista(p) ? (
                            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 text-xs font-medium">
                              Pendiente
                            </span>
                          ) : actaLista(p) ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-xs font-medium">
                              Firmada
                            </span>
                          ) : (
                            <span className="text-numa-500">—</span>
                          )}
                        </td>
                        <td className="table-cell max-w-[170px] truncate" title={p.demandante}>{p.demandante}</td>
                        <td className="table-cell max-w-[170px] truncate" title={p.demandado}>{p.demandado}</td>
                        <td className="table-cell">{p.sucursal ? labelSucursal(p) : "—"}</td>
                        {admin && (
                          <td className="table-cell max-w-[170px] truncate" title={p.usuario}>
                            {p.usuario || '—'}
                          </td>
                        )}
                        <td className="table-cell max-w-[200px] truncate" title={mayusInicial(p.tema)}>{mayusInicial(p.tema)}</td>
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
                              <ChevronDown className="w-4 h-4 text-numa-600" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-numa-600" />
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
                          <td className="table-cell tabular-nums">{(m.actas_subidas || 0) - (m.actas_no_acuerdo || 0)}</td>
                          <td className="table-cell tabular-nums">{m.actas_no_acuerdo || 0}</td>
                          <td className="table-cell">
                            {m.actas_pendientes > 0 ? (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleDetalleMediador(m.usuario_id, true);
                                }}
                                className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 text-xs font-medium cursor-pointer hover:bg-amber-100 underline decoration-dotted"
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
                          <td className="table-cell tabular-nums">{m.reuniones_realizadas ?? 0}</td>
                          <td className="table-cell tabular-nums">{m.reuniones_canceladas ?? 0}</td>
                          <td className="table-cell tabular-nums">{m.reuniones_no_asistieron ?? 0}</td>
                        </tr>

                        {mediadorExpandidoId === m.usuario_id && (
                          <tr key={`${m.usuario_id}-detalle`}>
                            <td colSpan={18} className="bg-numa-50 px-3 py-3">
                              {cargandoDetalleId === m.usuario_id ? (
                                <Spinner />
                              ) : !detalleProcesos[m.usuario_id]?.length ? (
                                <p className="text-xs text-numa-600 py-2">
                                  Este mediador no tiene procesos en este rango de fechas.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between flex-wrap gap-2">
                                    <p className="text-xs text-numa-700 font-medium">
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
                                        className="text-xs text-numa-700 underline hover:text-numa-800"
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
                                        <span className="text-xs text-numa-600 ml-2">
                                          {p.demandante} vs {p.demandado}
                                        </span>
                                      </div>

                                      <span className="text-xs text-numa-700">
                                        {getEstadoLabel(p.suspendido ? 'suspendido' : p.estado)} ·{' '}
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
                    actasMostradas.map((a: any) => (
                      <tr
                        key={a.id}
                        onClick={() => abrirProceso(a.proceso_id)}
                        className="table-row cursor-pointer hover:bg-gold-400/[0.06]"
                      >
                        <td className="table-cell font-medium">{a.codigo_acta}</td>
                        <td className="table-cell">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              esNoAcuerdo(a) ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'
                            }`}
                          >
                            {esNoAcuerdo(a) ? 'No acuerdo' : 'Acuerdo'}
                          </span>
                        </td>
                        <td className="table-cell">{a.demandante}</td>
                        <td className="table-cell">{a.demandado}</td>
                        <td className="table-cell">{a.ciudad || '—'}</td>
                        <td className="table-cell">{a.sucursal ? labelSucursal(a) : "—"}</td>
                        {admin && <td className="table-cell">{a.mediador || a.usuario || '—'}</td>}
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
                              <ChevronDown className="w-4 h-4 text-numa-600" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-numa-600" />
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
                          <td className="table-cell tabular-nums">{(s.actas_subidas || 0) - (s.actas_no_acuerdo || 0)}</td>
                          <td className="table-cell tabular-nums">{s.actas_no_acuerdo || 0}</td>
                          <td className="table-cell">
                            {s.actas_pendientes > 0 ? (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleDetalleSucursal(s.sucursal_id, true);
                                }}
                                className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 text-xs font-medium cursor-pointer hover:bg-amber-100 underline decoration-dotted"
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
                            <td colSpan={13} className="bg-numa-50 px-3 py-3">
                              {cargandoDetalleSucursalId === s.sucursal_id ? (
                                <Spinner />
                              ) : !detalleSucursal[s.sucursal_id]?.length ? (
                                <p className="text-xs text-numa-600 py-2">
                                  Esta sucursal no tiene procesos en este rango de fechas.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between flex-wrap gap-2">
                                    <p className="text-xs text-numa-700 font-medium">
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
                                        className="text-xs text-numa-700 underline hover:text-numa-800"
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
                                        <span className="text-xs text-numa-600 ml-2">
                                          {p.demandante} vs {p.demandado}
                                        </span>
                                      </div>

                                      <span className="text-xs text-numa-700">
                                        {getEstadoLabel(p.suspendido ? 'suspendido' : p.estado)} ·{' '}
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
                              <ChevronDown className="w-4 h-4 text-numa-600" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-numa-600" />
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
                                className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 text-xs font-medium cursor-pointer hover:bg-amber-100 underline decoration-dotted"
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
                            <td colSpan={15} className="bg-numa-50 px-3 py-3">
                              {cargandoDetalleClienteId === c.cliente_id ? (
                                <Spinner />
                              ) : !detalleCliente[c.cliente_id]?.length ? (
                                <p className="text-xs text-numa-600 py-2">
                                  Este cliente no tiene procesos en este rango de fechas.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between flex-wrap gap-2">
                                    <p className="text-xs text-numa-700 font-medium">
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
                                        className="text-xs text-numa-700 underline hover:text-numa-800"
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
                                        <span className="text-xs text-numa-600 ml-2">
                                          {p.demandante} vs {p.demandado}
                                        </span>
                                      </div>

                                      <span className="text-xs text-numa-700">
                                        {getEstadoLabel(p.suspendido ? 'suspendido' : p.estado)} ·{' '}
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
