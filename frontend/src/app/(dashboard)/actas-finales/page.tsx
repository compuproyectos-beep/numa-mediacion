'use client';

import { useEffect, useState } from 'react';
import { FileText, Download, Eye, CheckCircle2, Clock } from 'lucide-react';
import DocFila from '@/components/procesos/DocFila';
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
  reemplazarPdfActaFinal,
  exportarActasFinalesZip,
  getUsuarios
} from '@/lib/services';
import { getCiudadesCached, getSucursalesCached } from '@/lib/catalogCache';

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

      <div className="card p-4 mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          {/* Fila 1: buscar + los filtros de "dónde" */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
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
                      {s.nombre}
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
                {mediadores.map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre} {m.apellido}
                  </option>
                ))}
              </SelectField>
            )}
          </div>

          {/* Fila 2: usa la misma grilla de 6 columnas que la fila 1, para
              que "Descargar..." caiga justo debajo de "Mediador" (columna 5)
              en vez de pegarse al borde derecho de la tarjeta. Fechas juntas
              (cols 1-2), Buscar/Limpiar juntos (cols 3-4), Descargar (col 5). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-3 items-end">
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
              className="btn-primary whitespace-nowrap justify-self-start"
            >
              <Download className="w-4 h-4" />
              {filters.ciudad_id || filters.sucursal_id || filters.fecha_desde || filters.fecha_hasta
                ? 'Descargar filtrados'
                : 'Descargar todos'}
            </button>
            )}
          </div>
        </form>
      </div>

      <div className="mb-3 text-sm text-numa-500">
        Mostrando{' '}
        <span className="font-semibold text-numa-800">
          {actas.length}
        </span>{' '}
        {actas.length === 1 ? 'acta final' : 'actas finales'}
      </div>
    <div className="space-y-3">
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
            className={`card p-4 border border-numa-100 border-l-4 ${
              a.ruta_comprobante_pago ? 'border-l-green-500' : 'border-l-amber-400'
            }`}
          >
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-numa-500" />

                  <span className="font-semibold text-numa-900">
                    {a.codigo_acta}
                  </span>

                  <Badge label="Finalizada" variant="aprobado" />

                  {!a.ruta_comprobante_pago && (
                    <Badge label="Sin comprobante" variant="rechazado" />
                  )}
                </div>

                <p className="text-sm text-numa-600">
                  Proceso: <span className="font-medium">{a.codigo_proceso}</span>
                </p>

                <p className="text-sm text-numa-800">
                  {a.demandante} vs {a.demandado}
                </p>

                <p className="text-xs text-numa-400">
                  {a.ciudad} · {a.sucursal}
                </p>

                <p className="text-xs text-numa-400">
                  Subido por: {a.usuario || '—'} · Fecha:{' '}
                  {a.fecha_subida
                    ? new Date(a.fecha_subida).toLocaleDateString('es-EC')
                    : '—'}
                </p>

                {(formatearPeso(a.tamano_bytes) || formatearPeso(a.tamano_comprobante_bytes)) && (
                  <p className="text-xs text-numa-400">
                    Peso — Acta: {formatearPeso(a.tamano_bytes) || '—'}
                    {a.ruta_comprobante_pago && (
                      <> · Comprobante: {formatearPeso(a.tamano_comprobante_bytes) || '—'}</>
                    )}
                  </p>
                )}

              </div>

              <div className="flex flex-col gap-1 lg:items-end">
                <div className="space-y-0.5">
                  {(
                    <DocFila
                      etiqueta="Acta final"
                      textoVer="Ver acta"
                      onVer={() => handleVerPdf(a.id)}
                      onDescargar={isAdmin ? () => handleDescargarPdf(a.id, a.codigo_acta) : undefined}
                    />
                  )}
                  {a.ruta_comprobante_pago && (
                    <DocFila
                      etiqueta="Comprobante de pago"
                      textoVer="Ver comprobante"
                      onVer={() => handleVerComprobante(a.id)}
                      onDescargar={
                        isAdmin
                          ? () => handleDescargarComprobante(a.id, a.codigo_acta, a.nombre_comprobante_pago)
                          : undefined
                      }
                    />
                  )}
                  {a.requiere_acta_firmada && (
                    a.tiene_acta_firmada ? (
                      <div className="flex items-center gap-2 pt-1">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Acta firmada subida
                        </span>
                        <button
                          type="button"
                          onClick={() => handleVerFirmada(a.proceso_id)}
                          className="btn-secondary text-xs py-1 px-2"
                        >
                          <Eye className="w-4 h-4" /> Ver acta firmada
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => handleDescargarFirmada(a.proceso_id, a.codigo_acta)}
                            title="Descargar acta firmada"
                            aria-label="Descargar acta firmada"
                            className="btn-ghost p-1.5"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 pt-1">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          <Clock className="w-3.5 h-3.5" /> Falta subir el acta firmada
                        </span>
                        <a href={`/procesos/${a.proceso_id}`} className="btn-secondary text-xs py-1 px-2">
                          Ir al proceso
                        </a>
                      </div>
                    )
                  )}
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
{isAdmin && (
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      `/actas-finales/${a.id}/historial-imprimir`,
                      '_blank'
                    )
                  }
                  className="btn-ghost text-xs py-1 px-2"
                >
                  Historial
                </button>
                )}

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setActaReemplazar(a);
                      setArchivoReemplazo(null);
                      setMotivoReemplazo('');
                      setMensajeReemplazo('');
                    }}
                    className="btn-ghost text-xs py-1 px-2"
                  >
                    Reemplazar PDF
                  </button>
                )}
                </div>
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