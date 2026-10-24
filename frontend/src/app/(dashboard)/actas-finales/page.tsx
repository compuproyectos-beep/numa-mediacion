'use client';

import { useEffect, useState } from 'react';
import { FileText, Download, Eye, CheckCircle2, Clock, History, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  PageHeader,
  Spinner,
  EmptyState,
  Modal,
  Badge,
  InputField,
  SelectField,
  ErrorAlert
} from '@/components/ui';
import {
  getActasFinales,
  descargarPdfActaFinal,
  descargarActaFirmada,
  descargarComprobantePagoActaFinal,
  descargarComprobanteFinal,
  reemplazarPdfActaFinal,
  exportarActasFinalesZip,
  getUsuarios
} from '@/lib/services';
import { getCiudadesCached, getSucursalesCached } from '@/lib/catalogCache';
import NumeroActaPanel from '@/components/actas/NumeroActaPanel';

// Convierte bytes a un texto legible (KB o MB), para mostrar cuánto pesa
// cada acta/comprobante ya comprimido en Supabase Storage.
function formatearPeso(bytes?: number | null): string | null {
  if (bytes == null || bytes <= 0) return null;

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ActasFinalesPage() {
  const [actas, setActas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [ciudades, setCiudades] = useState<any[]>([]);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [mediadores, setMediadores] = useState<any[]>([]);

  const [filters, setFilters] = useState({
    q: '',
    ciudad_id: '',
    sucursal_id: '',
    usuario_id: '',
    fecha_desde: '',
    fecha_hasta: ''
  });

  const [actaReemplazar, setActaReemplazar] = useState<any | null>(null);
  const [archivoReemplazo, setArchivoReemplazo] = useState<File | null>(null);
  const [motivoReemplazo, setMotivoReemplazo] = useState('');
  const [reemplazando, setReemplazando] = useState(false);
  const [mensajeReemplazo, setMensajeReemplazo] = useState('');
  const [error, setError] = useState('');
  const [exportando, setExportando] = useState(false);

  const load = async () => {
    setLoading(true);

    try {
      const data = await getActasFinales({
        q: filters.q || undefined,
        ciudad_id: filters.ciudad_id || undefined,
        sucursal_id: filters.sucursal_id || undefined,
        usuario_id: filters.usuario_id || undefined,
        fecha_desde: filters.fecha_desde || undefined,
        fecha_hasta: filters.fecha_hasta || undefined,
      });

      setActas(data);
    } catch {
      setActas([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();

    getCiudadesCached(true).then(setCiudades).catch(() => setCiudades([]));
    getSucursalesCached().then(setSucursales).catch(() => setSucursales([]));
  }, []);

  const { isAdmin } = useAuth();

  useEffect(() => {
    if (isAdmin) {
      getUsuarios().then(setMediadores).catch(() => setMediadores([]));
    }
  }, [isAdmin]);

  const limpiarFiltros = () => {
    setFilters({
      q: '',
      ciudad_id: '',
      sucursal_id: '',
      usuario_id: '',
      fecha_desde: '',
      fecha_hasta: ''
    });

    getActasFinales().then(setActas);
  };

  const handleVerPdf = async (actaId: number) => {
    try {
      const blob = await descargarPdfActaFinal(actaId);
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch {
      setError('No se pudo abrir el PDF');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleVerComprobante = async (actaId: number) => {
    try {
      const blob = await descargarComprobantePagoActaFinal(actaId);
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch {
      setError('No se pudo abrir el comprobante de pago');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleVerComprobanteFinal = async (procesoId: number) => {
    try {
      const blob = await descargarComprobanteFinal(procesoId);
      window.open(window.URL.createObjectURL(blob), '_blank');
    } catch {
      setError('No se pudo abrir el comprobante del segundo pago');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleDescargarComprobanteFinal = async (procesoId: number, codigoActa: string) => {
    try {
      const blob = await descargarComprobanteFinal(procesoId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const ext = (blob.type.split('/')[1] || 'pdf').replace('jpeg', 'jpg');
      link.href = url;
      link.download = `comprobante_2_${codigoActa}.${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar el comprobante del segundo pago');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleVerFirmada = async (procesoId: number) => {
    try {
      const blob = await descargarActaFirmada(procesoId);
      window.open(window.URL.createObjectURL(blob), '_blank');
    } catch {
      setError('No se pudo abrir el acta firmada');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleDescargarFirmada = async (procesoId: number, codigoActa: string) => {
    try {
      const blob = await descargarActaFirmada(procesoId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `acta_firmada_${codigoActa}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar el acta firmada');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleDescargarPdf = async (actaId: number, codigoActa: string) => {
    try {
      const blob = await descargarPdfActaFinal(actaId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = `${codigoActa}.pdf`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar el PDF');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleDescargarComprobante = async (actaId: number, codigoActa: string, nombreComprobante?: string) => {
    try {
      const blob = await descargarComprobantePagoActaFinal(actaId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');

      const extension = nombreComprobante?.includes('.')
        ? nombreComprobante.split('.').pop()
        : 'pdf';

      link.href = url;
      link.download = `comprobante_${codigoActa}.${extension}`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar el comprobante de pago');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleReemplazarPdf = async () => {
    if (!actaReemplazar || !archivoReemplazo) {
      setError('Seleccione un archivo PDF');
      return;
    }

    if (!motivoReemplazo.trim()) {
      setError('Ingrese el motivo del reemplazo');
      return;
    }

    setError('');
    setReemplazando(true);

    try {
      await reemplazarPdfActaFinal(
        actaReemplazar.id,
        archivoReemplazo,
        motivoReemplazo
      );

      const data = await getActasFinales();
      setActas(data);

      setArchivoReemplazo(null);
      setMotivoReemplazo('');
      setMensajeReemplazo('PDF reemplazado correctamente');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Error al reemplazar PDF');
    } finally {
      setReemplazando(false);
    }
  };


const handleExportarZip = async () => {
  if (exportando) return;
  setExportando(true);
  setError('');
  try {
    const blob = await exportarActasFinalesZip({
      ciudad_id: filters.ciudad_id || undefined,
      sucursal_id: filters.sucursal_id || undefined,
      fecha_desde: filters.fecha_desde || undefined,
      fecha_hasta: filters.fecha_hasta || undefined,
    });

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'actas_finales_numa.zip';

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.URL.revokeObjectURL(url);
  } catch (err: any) {
    setError(
      err?.response?.data?.detail ||
        'No se pudo exportar el ZIP'
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } finally {
    setExportando(false);
  }
};

  return (
    <>
      <PageHeader
          title="Actas Finales"
          subtitle="Actas PDF generadas al finalizar procesos de mediación"
        />

      {error && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}

      <NumeroActaPanel esAdmin={isAdmin} />

      <div className="card px-3 py-2.5 mb-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          {/* Fila 1: buscar + los filtros de "dónde" */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            <div className="xl:col-span-2">
              <InputField
                label="Buscar"
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                placeholder="Acta, proceso, cliente o cédula..."
              />
            </div>

            {isAdmin && (
              <SelectField
                label="Ciudad"
                value={filters.ciudad_id}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    ciudad_id: e.target.value,
                    sucursal_id: ''
                  })
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

            {isAdmin && (
              <SelectField
                label="Sucursal"
                value={filters.sucursal_id}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    sucursal_id: e.target.value
                  })
                }
              >
                <option value="">Todas</option>
                {sucursales
                  .filter((s: any) =>
                    filters.ciudad_id
                      ? String(s.ciudad_id) === String(filters.ciudad_id)
                      : true
                  )
                  .map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}{(s.ciudad_nombre || s.ciudad) ? ` · ${s.ciudad_nombre || s.ciudad}` : ''}
                    </option>
                  ))}
              </SelectField>
            )}

            {isAdmin && (
              <SelectField
                label="Mediador"
                value={filters.usuario_id}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    usuario_id: e.target.value
                  })
                }
              >
                <option value="">Todos</option>
                {mediadores.filter((m: any) => m.rol !== 'secretaria').map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre} {m.apellido}{m.rol === 'administrador' ? ' (administrador)' : ''}
                  </option>
                ))}
              </SelectField>
            )}
          </div>

          {/* Fila 2: usa la misma grilla de 6 columnas que la fila 1, para
              que "Descargar..." caiga justo debajo de "Mediador" (columna 5)
              en vez de pegarse al borde derecho de la tarjeta. Fechas juntas
              (cols 1-2), Buscar/Limpiar juntos (cols 3-4), Descargar (col 5). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 mt-2 items-end">
            <div className="xl:col-span-2 flex items-end gap-2">
              <div className="w-36">
                <InputField
                  label="Fecha desde"
                  type="date"
                  value={filters.fecha_desde}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      fecha_desde: e.target.value
                    })
                  }
                />
              </div>

              <div className="w-36">
                <InputField
                  label="Fecha hasta"
                  type="date"
                  value={filters.fecha_hasta}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      fecha_hasta: e.target.value
                    })
                  }
                />
              </div>
            </div>

            <div className="xl:col-span-2 flex items-center gap-1.5">
              <button type="submit" className="btn-primary">
                Buscar
              </button>

              <button type="button" onClick={limpiarFiltros} className="btn-secondary">
                Limpiar
              </button>
            </div>

            {isAdmin && (
            <button
              type="button"
              onClick={handleExportarZip}
              disabled={exportando}
              className="btn-primary whitespace-nowrap justify-self-start disabled:opacity-70 disabled:cursor-wait"
            >
              <Download className={`w-4 h-4 ${exportando ? 'animate-bounce' : ''}`} />
              {exportando
                ? 'Preparando descarga, espera un momento...'
                : filters.ciudad_id || filters.sucursal_id || filters.fecha_desde || filters.fecha_hasta
                ? 'Descargar filtrados'
                : 'Descargar todos'}
            </button>
            )}
          </div>
        </form>
      </div>

      <div className="mb-2 text-[13px] text-numa-700">
        Mostrando{' '}
        <span className="font-semibold text-numa-800">
          {actas.length}
        </span>{' '}
        {actas.length === 1 ? 'acta final' : 'actas finales'}
      </div>
    <div className="space-y-2">
      {loading ? (
        <Spinner />
      ) : actas.length === 0 ? (
        <div className="card p-6">
          <EmptyState message="No hay actas finales registradas." />
        </div>
      ) : (
        actas.map((a) => (
          <div
            key={a.id}
            className={`card px-3 py-2 border border-numa-100 border-l-4 ${
              a.ruta_comprobante_pago ? 'border-l-green-500' : 'border-l-amber-400'
            }`}
          >
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <FileText className="w-4 h-4 text-numa-700" />

                  <span className="font-semibold text-numa-900">
                    {a.codigo_acta}
                  </span>

                  <Badge label="Finalizada" variant="aprobado" />

                  {a.tipo === 'no_acuerdo' && <Badge label="No acuerdo" variant="borrador" />}

                  {a.pago_pendiente && <Badge label="Saldo pendiente" variant="enviado" />}

                  {!a.ruta_comprobante_pago && (
                    <Badge label="Sin comprobante" variant="rechazado" />
                  )}

                  {a.requiere_facturas && (
                    a.falta_factura_cliente || a.falta_factura_mediador ? (
                      <Badge
                        label={
                          a.falta_factura_cliente && a.falta_factura_mediador
                            ? 'Faltan 2 facturas'
                            : 'Falta 1 factura'
                        }
                        variant="enviado"
                      />
                    ) : (
                      <Badge label="Facturas completas" variant="aprobado" />
                    )
                  )}
                </div>

                <p className="text-[15px] font-medium text-numa-900">
                  {a.demandante} y {a.demandado}
                </p>

                <p className="text-[13px] text-numa-700">
                  {a.ciudad} · {a.sucursal} · Subido por: {a.usuario || '—'} · Fecha:{' '}
                  {a.fecha_subida
                    ? new Date(a.fecha_subida).toLocaleDateString('es-EC')
                    : '—'}
                </p>

                {a.fact_nombre && (
                  <p className="text-[13px] text-numa-800">
                    Facturar a: <span className="font-medium text-numa-700">{a.fact_nombre}</span>
                    {' · '}
                    {a.fact_tipo_identificacion === 'ruc'
                      ? 'RUC'
                      : a.fact_tipo_identificacion === 'pasaporte'
                        ? 'Pasaporte'
                        : 'C.I.'}{' '}
                    {a.fact_identificacion}
                  </p>
                )}

                {(formatearPeso(a.tamano_bytes) || formatearPeso(a.tamano_comprobante_bytes)) && (
                  <p className="text-[13px] text-numa-700">
                    Peso — Acta: {formatearPeso(a.tamano_bytes) || '—'}
                    {a.ruta_comprobante_pago && (
                      <> · Comprobante: {formatearPeso(a.tamano_comprobante_bytes) || '—'}</>
                    )}
                  </p>
                )}

              </div>

              {/* Documentos: una grilla de 3 columnas (nombre · ver · descargar)
                  para que todo quede alineado, con las acciones de control
                  del administrador separadas abajo. */}
              <div className="lg:w-[340px] shrink-0 rounded-md border border-numa-200 bg-numa-50 px-3 py-2">
                <p className="text-[11px] font-bold text-numa-700 uppercase tracking-wider mb-1.5 pb-1 border-b border-numa-200">
                  Documentos
                </p>
                <div className="grid grid-cols-[1fr_auto_2rem] items-center gap-x-2 gap-y-1 text-[13px]">
                  <span className="text-numa-800 font-medium whitespace-nowrap">Documentos del acta</span>
                  <button type="button" onClick={() => handleVerPdf(a.id)} className="btn-sm w-[6rem] inline-flex items-center justify-center gap-1.5 rounded-md bg-numa-900 text-white font-semibold hover:bg-numa-800 transition-colors">
                    <Eye className="w-3.5 h-3.5" /> Ver
                  </button>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => handleDescargarPdf(a.id, a.codigo_acta)}
                      title="Descargar documentos del acta"
                      aria-label="Descargar documentos del acta"
                      className="btn-icon bg-white border border-numa-200 text-numa-700 hover:border-gold-400 hover:bg-gold-400/10"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  ) : (
                    <span />
                  )}

                  {a.ruta_comprobante_pago && (
                    <>
                      <span className="text-numa-800 font-medium whitespace-nowrap">
                        {a.comprobante_final_id ? 'Comprobante 1.er pago' : 'Comprobante de pago'}
                      </span>
                      <button type="button" onClick={() => handleVerComprobante(a.id)} className="btn-sm w-[6rem] inline-flex items-center justify-center gap-1.5 rounded-md bg-numa-900 text-white font-semibold hover:bg-numa-800 transition-colors">
                        <Eye className="w-3.5 h-3.5" /> Ver
                      </button>
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() =>
                            handleDescargarComprobante(a.id, a.codigo_acta, a.nombre_comprobante_pago)
                          }
                          title="Descargar comprobante"
                          aria-label="Descargar comprobante"
                          className="btn-icon bg-white border border-numa-200 text-numa-700 hover:border-gold-400 hover:bg-gold-400/10"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      ) : (
                        <span />
                      )}
                    </>
                  )}

                  {a.comprobante_final_id && (
                    <>
                      <span className="text-numa-800 font-medium whitespace-nowrap">Comprobante 2.º pago</span>
                      <button
                        type="button"
                        onClick={() => handleVerComprobanteFinal(a.proceso_id)}
                        className="btn-sm w-[6rem] inline-flex items-center justify-center gap-1.5 rounded-md bg-numa-900 text-white font-semibold hover:bg-numa-800 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" /> Ver
                      </button>
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => handleDescargarComprobanteFinal(a.proceso_id, a.codigo_acta)}
                          title="Descargar comprobante del 2.º pago"
                          aria-label="Descargar comprobante del 2.º pago"
                          className="btn-icon bg-white border border-numa-200 text-numa-700 hover:border-gold-400 hover:bg-gold-400/10"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      ) : (
                        <span />
                      )}
                    </>
                  )}

                  {a.requiere_acta_firmada && (
                    <>
                      <span className="text-numa-800 font-medium inline-flex items-center gap-1.5">
                        Acta firmada
                        {a.tiene_acta_firmada ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-label="Subida" />
                        ) : null}
                      </span>
                      {a.tiene_acta_firmada ? (
                        <button
                          type="button"
                          onClick={() => handleVerFirmada(a.proceso_id)}
                          className="btn-sm w-[6rem] inline-flex items-center justify-center gap-1.5 rounded-md bg-numa-900 text-white font-semibold hover:bg-numa-800 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" /> Ver
                        </button>
                      ) : (
                        <a
                          href={`/procesos/${a.proceso_id}`}
                          title="Ir al proceso para subirla"
                          className="pill bg-amber-50 text-amber-800 border-amber-200 w-[6rem] justify-center hover:bg-amber-100"
                        >
                          <Clock className="w-3.5 h-3.5" /> Falta subir
                        </a>
                      )}
                      {isAdmin && a.tiene_acta_firmada ? (
                        <button
                          type="button"
                          onClick={() => handleDescargarFirmada(a.proceso_id, a.codigo_acta)}
                          title="Descargar acta firmada"
                          aria-label="Descargar acta firmada"
                          className="btn-icon bg-white border border-numa-200 text-numa-700 hover:border-gold-400 hover:bg-gold-400/10"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      ) : (
                        <span />
                      )}
                    </>
                  )}
                </div>

                {isAdmin && (
                  <div className="flex gap-1 mt-1.5 pt-1 border-t border-numa-200">
                    <button
                      type="button"
                      onClick={() => window.open(`/actas-finales/${a.id}/historial-imprimir`, '_blank')}
                      className="btn-sm inline-flex items-center gap-1.5 rounded-md bg-white border border-numa-200 text-numa-700 font-medium hover:border-gold-400"
                    >
                      <History className="w-3.5 h-3.5" /> Historial
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActaReemplazar(a);
                        setArchivoReemplazo(null);
                        setMotivoReemplazo('');
                        setMensajeReemplazo('');
                      }}
                      className="btn-sm inline-flex items-center gap-1.5 rounded-md bg-white border border-numa-200 text-numa-700 font-medium hover:border-gold-400"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Reemplazar PDF
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>

      <Modal
        open={!!actaReemplazar}
        onClose={() => {
          setActaReemplazar(null);
          setArchivoReemplazo(null);
          setMotivoReemplazo('');
          setMensajeReemplazo('');
          setError('');
        }}
        title={`Reemplazar PDF — ${actaReemplazar?.codigo_acta || ''}`}
        size="md"
      >
        <div className="space-y-4">
          {mensajeReemplazo && (
            <div className="p-3 bg-green-50 border border-green-100 text-green-700 text-sm rounded-sm">
              {mensajeReemplazo}
            </div>
          )}

          {error && <ErrorAlert message={error} />}

          <p className="text-sm text-numa-600">
            Solo administración puede reemplazar el PDF final. El motivo quedará registrado para control interno.
          </p>

          <input
            type="file"
            accept="application/pdf"
            onChange={(e) =>
              setArchivoReemplazo(e.target.files?.[0] || null)
            }
            className="input-field"
          />

          <textarea
            value={motivoReemplazo}
            onChange={(e) => setMotivoReemplazo(e.target.value)}
            rows={4}
            className="input-field"
            placeholder="Motivo del reemplazo..."
          />

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={() => {
                setActaReemplazar(null);
                setArchivoReemplazo(null);
                setMotivoReemplazo('');
                setMensajeReemplazo('');
                setError('');
              }}
              className="btn-secondary"
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleReemplazarPdf}
              disabled={reemplazando}
              className="btn-primary"
            >
              {reemplazando ? 'Reemplazando...' : 'Reemplazar PDF'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}