'use client';

import { useEffect, useState } from 'react';
import { FileSpreadsheet, Printer, Search } from 'lucide-react';
import {
  PageHeader,
  Spinner,
  EmptyState,
  SelectField,
  InputField,
  ErrorAlert
} from '@/components/ui';
import {
  getProcesos,
  getActasFinales,
  getReporteProductividad,
  descargarReporteExcel,
  getUsuarios
} from '@/lib/services';
import { getCiudadesCached, getSucursalesCached } from '@/lib/catalogCache';
import { isAdmin } from '@/lib/auth';

type TipoReporte = 'procesos' | 'productividad' | 'actas';

const TIPOS: { valor: TipoReporte; titulo: string }[] = [
  { valor: 'procesos', titulo: 'Procesos por periodo' },
  { valor: 'productividad', titulo: 'Productividad por mediador' },
  { valor: 'actas', titulo: 'Actas finales emitidas' }
];

const getEstadoLabel = (estado: string) => {
  const labels: any = {
    en_negociacion: 'En negociación',
    cerrado_con_acuerdo: 'Cerrado con acuerdo',
    cerrado_sin_acuerdo: 'Cerrado sin acuerdo',
    archivado: 'Archivado'
  };

  return labels[estado] || estado;
};

export default function ReportesPage() {
  const admin = isAdmin();

  const [tipo, setTipo] = useState<TipoReporte>('procesos');

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
  const [buscado, setBuscado] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSucursalesCached().then(setSucursales).catch(() => setSucursales([]));
    getCiudadesCached(true).then(setCiudades).catch(() => setCiudades([]));

    if (admin) {
      getUsuarios()
        .then((data) => setMediadores(data.filter((u: any) => u.rol === 'mediador' && u.activo)))
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

  const buscar = async () => {
    setLoading(true);
    setError('');
    setBuscado(true);

    try {
      let data: any[] = [];

      if (tipo === 'procesos') {
        data = await getProcesos(filtrosActivos);
      } else if (tipo === 'productividad') {
        data = await getReporteProductividad(filtrosActivos);
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
  };

  const handleExportarExcel = async () => {
    setExportando(true);
    setError('');

    try {
      const blob = await descargarReporteExcel(tipo, filtrosActivos);
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

    Object.entries(filtrosActivos).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });

    window.open(`/reportes/imprimir?${params.toString()}`, '_blank');
  };

  // Resumen rápido arriba de la tabla: para procesos, cuántos hay en cada
  // estado; para actas y productividad, solo el total encontrado.
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
        {TIPOS.map((t) => (
          <button
            key={t.valor}
            type="button"
            onClick={() => cambiarTipo(t.valor)}
            className={`px-4 py-2 rounded-sm text-sm font-medium transition-colors ${
              tipo === t.valor
                ? 'bg-numa-900 text-numa-50'
                : 'bg-white border border-numa-200 text-numa-600 hover:bg-numa-100'
            }`}
          >
            {t.titulo}
          </button>
        ))}
      </div>

      <div className="card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
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
          <button onClick={buscar} className="btn-primary">
            <Search className="w-4 h-4" />
            Generar reporte
          </button>

          {buscado && datos.length > 0 && (
            <>
              <button
                onClick={handleExportarExcel}
                disabled={exportando}
                className="btn-secondary"
              >
                <FileSpreadsheet className="w-4 h-4" />
                {exportando ? 'Descargando...' : 'Descargar Excel'}
              </button>

              <button onClick={handleImprimir} className="btn-secondary">
                <Printer className="w-4 h-4" />
                Imprimir / PDF
              </button>
            </>
          )}
        </div>
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
            </div>
          )}

          {tipo !== 'procesos' && (
            <div className="text-sm text-numa-500">
              Mostrando <span className="font-semibold text-numa-800">{datos.length}</span>{' '}
              {tipo === 'productividad'
                ? datos.length === 1
                  ? 'mediador'
                  : 'mediadores'
                : datos.length === 1
                ? 'acta final'
                : 'actas finales'}
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-numa-50 border-b border-numa-100">
                  <tr>
                    {tipo === 'procesos' && (
                      <>
                        <th className="table-header">Código</th>
                        <th className="table-header">Estado</th>
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
                        <th className="table-header">Mediador</th>
                        <th className="table-header">Ciudad</th>
                        <th className="table-header">Sucursal</th>
                        <th className="table-header">Total</th>
                        <th className="table-header">En negociación</th>
                        <th className="table-header">Con acuerdo</th>
                        <th className="table-header">Sin acuerdo</th>
                        <th className="table-header">Archivados</th>
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
                  </tr>
                </thead>

                <tbody>
                  {tipo === 'procesos' &&
                    datos.map((p: any) => (
                      <tr key={p.id} className="table-row">
                        <td className="table-cell font-medium">{p.codigo_proceso}</td>
                        <td className="table-cell">{getEstadoLabel(p.estado)}</td>
                        <td className="table-cell">{p.demandante}</td>
                        <td className="table-cell">{p.demandado}</td>
                        <td className="table-cell">{p.ciudad || '—'}</td>
                        <td className="table-cell">{p.sucursal || '—'}</td>
                        {admin && <td className="table-cell">{p.usuario || '—'}</td>}
                        <td className="table-cell max-w-xs truncate">{p.tema}</td>
                        <td className="table-cell">
                          {p.fecha_creacion
                            ? new Date(p.fecha_creacion).toLocaleDateString('es-EC')
                            : '—'}
                        </td>
                      </tr>
                    ))}

                  {tipo === 'productividad' &&
                    datos.map((m: any) => (
                      <tr key={m.usuario_id} className="table-row">
                        <td className="table-cell font-medium">{m.mediador}</td>
                        <td className="table-cell">{m.ciudad || '—'}</td>
                        <td className="table-cell">{m.sucursal || '—'}</td>
                        <td className="table-cell">{m.total_procesos}</td>
                        <td className="table-cell">{m.en_negociacion}</td>
                        <td className="table-cell">{m.cerrados_con_acuerdo}</td>
                        <td className="table-cell">{m.cerrados_sin_acuerdo}</td>
                        <td className="table-cell">{m.archivados}</td>
                        <td className="table-cell">
                          {m.promedio_dias_cierre != null ? `${m.promedio_dias_cierre} días` : '—'}
                        </td>
                      </tr>
                    ))}

                  {tipo === 'actas' &&
                    datos.map((a: any) => (
                      <tr key={a.id} className="table-row">
                        <td className="table-cell font-medium">{a.codigo_acta}</td>
                        <td className="table-cell">{a.codigo_proceso}</td>
                        <td className="table-cell">{a.demandante}</td>
                        <td className="table-cell">{a.demandado}</td>
                        <td className="table-cell">{a.ciudad || '—'}</td>
                        <td className="table-cell">{a.sucursal || '—'}</td>
                        {admin && <td className="table-cell">{a.usuario || '—'}</td>}
                        <td className="table-cell">
                          {a.fecha_subida
                            ? new Date(a.fecha_subida).toLocaleDateString('es-EC')
                            : '—'}
                        </td>
                      </tr>
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
