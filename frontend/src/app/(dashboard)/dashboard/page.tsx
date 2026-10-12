'use client';

import { etapaActaBadge } from '@/lib/etapaActa';
import { useEffect, useRef, useState } from 'react';
import {
  FileText,
  CheckCircle,
  Clock,
  Archive,
  FileCheck,
  LayoutDashboard,
  HardDrive,
  ChevronDown,
  DatabaseBackup
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { StatCard, Spinner, ErrorAlert, PageHeader, Badge, EmptyState, Pill } from '@/components/ui';
import { estadoLabel, estadoPill } from '@/lib/estados';
import { getDashboard, getUsoAlmacenamiento, getProcesos, getActasFinales, enviarRespaldoManual } from '@/lib/services';
import { useAuth } from '@/hooks/useAuth';
import { GuiaBienvenida, useGuiaBienvenida } from '@/components/dashboard/GuiaBienvenida';
import ResumenActasMes from '@/components/dashboard/ResumenActasMes';
import AlertaActasAtrasadas from '@/components/dashboard/AlertaActasAtrasadas';

// Cada tarjeta clickeable del resumen corresponde a un filtro de estado de
// procesos, salvo "actas_finales" que no es un estado de proceso sino la
// lista de actas ya subidas.
const CATEGORIAS: Record<
  string,
  { titulo: string; estadoProceso?: string; verTodoHref: string }
> = {
  en_negociacion: {
    titulo: 'En negociación',
    estadoProceso: 'en_negociacion',
    verTodoHref: '/procesos?estado=en_negociacion'
  },
  cerrado_con_acuerdo: {
    titulo: 'Con acuerdo',
    estadoProceso: 'cerrado_con_acuerdo',
    verTodoHref: '/procesos?estado=cerrado_con_acuerdo'
  },
  cerrado_sin_acuerdo: {
    titulo: 'Sin acuerdo',
    estadoProceso: 'cerrado_sin_acuerdo',
    verTodoHref: '/procesos?estado=cerrado_sin_acuerdo'
  },
  archivado: {
    titulo: 'Archivados',
    estadoProceso: 'archivado',
    verTodoHref: '/procesos?estado=archivado'
  },
  actas_finales: {
    titulo: 'Actas finales',
    verTodoHref: '/actas-finales'
  }
};

// Texto legible para el estado de cada proceso (la base guarda el código
// técnico, p. ej. "cerrado_sin_acuerdo").
const ETIQUETAS_ESTADO: Record<string, string> = {
  en_negociacion: 'En negociación',
  cerrado_con_acuerdo: 'Cerrado con acuerdo',
  cerrado_sin_acuerdo: 'Cerrado sin acuerdo',
  archivado: 'Archivado',
  anulado: 'Anulado'
};

export default function DashboardPage() {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const { mostrar: mostrarGuia, cerrarGuia, abrirGuia } = useGuiaBienvenida();
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [almacenamiento, setAlmacenamiento] = useState<any | null>(null);
  const [loadingAlmacenamiento, setLoadingAlmacenamiento] = useState(isAdmin);

  const [enviandoRespaldo, setEnviandoRespaldo] = useState(false);
  const [resultadoRespaldo, setResultadoRespaldo] = useState<{
    ok: boolean;
    mensaje: string;
  } | null>(null);

  const handleEnviarRespaldo = async () => {
    setEnviandoRespaldo(true);
    setResultadoRespaldo(null);
    try {
      const data = await enviarRespaldoManual();
      setResultadoRespaldo({
        ok: true,
        mensaje: `${data.motivo} (${data.tamano_mb} MB, ${data.tablas} tablas)`,
      });
    } catch (err: any) {
      const esTimeout = err?.code === 'ECONNABORTED';
      setResultadoRespaldo({
        ok: false,
        mensaje: esTimeout
          ? 'El servidor no respondió a tiempo (45s). Probablemente el servidor de correo (SMTP) no está respondiendo — revisa que SMTP_USER/SMTP_PASSWORD estén bien configurados en Railway, o si el proveedor de correo está bloqueando la conexión.'
          : err?.response?.data?.detail ||
            'No se pudo generar/enviar el respaldo. Intenta de nuevo.',
      });
    } finally {
      setEnviandoRespaldo(false);
    }
  };

  // Tarjeta clickeada actualmente (una de las claves de CATEGORIAS), la
  // lista que trae y su estado de carga.
  const [categoriaAbierta, setCategoriaAbierta] = useState<string | null>(null);
  const [listaCategoria, setListaCategoria] = useState<any[]>([]);
  const [loadingCategoria, setLoadingCategoria] = useState(false);
  const [errorCategoria, setErrorCategoria] = useState('');

  // El panel de resultados aparece más abajo, debajo de las tarjetas — en
  // un celular (o incluso en una pantalla chica) queda fuera de la vista
  // y no se nota que hay que bajar para verlo. Igual que en el calendario
  // de Agenda, se baja la pantalla sola hasta ahí apenas se abre.
  const panelCategoriaRef = useRef<HTMLDivElement>(null);

  const bajarAPanelCategoria = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panelCategoriaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  };

  const toggleCategoria = async (clave: string) => {
    if (categoriaAbierta === clave) {
      setCategoriaAbierta(null);
      return;
    }

    setCategoriaAbierta(clave);
    setListaCategoria([]);
    setErrorCategoria('');
    setLoadingCategoria(true);
    bajarAPanelCategoria();

    try {
      const info = CATEGORIAS[clave];
      const data = info.estadoProceso
        ? await getProcesos({ estado: info.estadoProceso })
        : await getActasFinales();

      setListaCategoria(data);
    } catch {
      setErrorCategoria('No se pudo cargar la lista.');
    } finally {
      setLoadingCategoria(false);
    }
  };

  useEffect(() => {
    getDashboard()
      .then(setStats)
      .catch(() =>
        setError('No se pudo cargar el dashboard. Verifique la conexión con el servidor.')
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;

    getUsoAlmacenamiento()
      .then(setAlmacenamiento)
      .catch(() => setAlmacenamiento(null))
      .finally(() => setLoadingAlmacenamiento(false));
  }, [isAdmin]);

  const procesos = stats?.procesos || {};

  return (
    <>
      <PageHeader
        title="Panel General"
        subtitle={
          isAdmin
            ? 'Resumen práctico del sistema'
            : `${user?.sucursal || 'Sucursal'} · ${user?.ciudad || 'Ciudad'}`
        }
        action={
          <button type="button" onClick={abrirGuia} className="btn-secondary btn-sm">
            ¿Cómo funciona?
          </button>
        }
      />

      <GuiaBienvenida open={mostrarGuia} onClose={cerrarGuia} />

      {error && <ErrorAlert message={error} />}

      {loading ? (
        <Spinner />
      ) : stats ? (
        <div className="space-y-6 animate-fade-in">
          {isAdmin && <AlertaActasAtrasadas />}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <StatCard
              label="En negociación"
              value={procesos.en_negociacion ?? 0}
              icon={Clock}
              color="bg-sky-600 text-white" relleno="bg-sky-50 border-sky-200"
              onClick={() => toggleCategoria('en_negociacion')}
              active={categoriaAbierta === 'en_negociacion'}
            />

            <StatCard
              label="Con acuerdo"
              value={procesos.cerrados_con_acuerdo ?? 0}
              icon={CheckCircle}
              color="bg-emerald-600 text-white" relleno="bg-emerald-50 border-emerald-200"
              onClick={() => toggleCategoria('cerrado_con_acuerdo')}
              active={categoriaAbierta === 'cerrado_con_acuerdo'}
            />

            <StatCard
              label="Sin acuerdo"
              value={procesos.cerrados_sin_acuerdo ?? 0}
              icon={FileText}
              color="bg-stone-500 text-white" relleno="bg-stone-100 border-stone-200"
              onClick={() => toggleCategoria('cerrado_sin_acuerdo')}
              active={categoriaAbierta === 'cerrado_sin_acuerdo'}
            />

            <StatCard
              label="Archivados"
              value={procesos.archivados ?? 0}
              icon={Archive}
              color="bg-slate-400 text-white" relleno="bg-slate-100 border-slate-200"
              onClick={() => toggleCategoria('archivado')}
              active={categoriaAbierta === 'archivado'}
            />

            <StatCard
              label="Actas finales"
              value={stats.actas_finales ?? 0}
              icon={FileCheck}
              color="bg-numa-900 text-gold-400" relleno="bg-gold-400/10 border-gold-400/40"
              onClick={() => toggleCategoria('actas_finales')}
              active={categoriaAbierta === 'actas_finales'}
            />
          </div>

          {/* Panel que se despliega al hacer clic en una de las tarjetas de
              arriba: muestra los procesos (o actas) de esa categoría, cada
              uno clickeable para ir directo a su proceso, y un botón para
              ver la lista completa con el filtro ya aplicado. */}
          {categoriaAbierta && (
            <div ref={panelCategoriaRef} className="card p-6 animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-numa-700 uppercase tracking-wider flex items-center gap-2">
                  <ChevronDown className="w-4 h-4 text-numa-400" />
                  {CATEGORIAS[categoriaAbierta].titulo}
                </h2>

                <button
                  type="button"
                  onClick={() => router.push(CATEGORIAS[categoriaAbierta].verTodoHref)}
                  className="btn-secondary btn-sm"
                >
                  Mostrar todo
                </button>
              </div>

              {loadingCategoria ? (
                <Spinner />
              ) : errorCategoria ? (
                <ErrorAlert message={errorCategoria} />
              ) : listaCategoria.length === 0 ? (
                <EmptyState message="No hay registros en esta categoría." />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {listaCategoria.slice(0, 10).map((item: any) => (
                    <div
                      key={item.id}
                      onClick={() =>
                        router.push(
                          `/procesos/${
                            categoriaAbierta === 'actas_finales' ? item.proceso_id : item.id
                          }`
                        )
                      }
                      className="p-4 border border-numa-200/80 rounded-md bg-white cursor-pointer card-lift hover:border-numa-300 hover:shadow-md"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <p className="font-semibold text-numa-900 code-text">
                            {categoriaAbierta === 'actas_finales'
                              ? item.codigo_acta
                              : item.codigo_proceso}
                          </p>
                          {/* Un proceso "cerrado con acuerdo" no significa que ya
                              esté todo listo: se muestra qué le falta. */}
                          {categoriaAbierta === 'cerrado_con_acuerdo' && etapaActaBadge(item) && (
                            <Pill {...etapaActaBadge(item)!} />
                          )}
                        </div>
                        <span className="text-xs text-numa-400 shrink-0">
                          {(item.fecha_creacion || item.fecha_subida)
                            ? new Date(
                                item.fecha_creacion || item.fecha_subida
                              ).toLocaleDateString('es-EC')
                            : '—'}
                        </span>
                      </div>

                      <p className="text-sm font-medium text-numa-800 mt-1.5 line-clamp-2">
                        {item.demandante} <span className="font-normal text-numa-400">vs</span> {item.demandado}
                      </p>

                      <p className="text-xs text-numa-500 mt-1 flex flex-wrap gap-x-3">
                        {categoriaAbierta === 'actas_finales' && <span>Proceso: {item.codigo_proceso}</span>}
                        <span>{item.ciudad || '—'} · {item.sucursal || '—'}</span>
                        {isAdmin && <span>Mediador: {item.usuario || '—'}</span>}
                      </p>
                    </div>
                  ))}

                  {listaCategoria.length > 10 && (
                    <p className="text-xs text-numa-400 text-center pt-1 md:col-span-2">
                      Mostrando 10 de {listaCategoria.length}. Usa &quot;Mostrar todo&quot;
                      para ver la lista completa.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="card p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold text-numa-700 uppercase tracking-wider">
                  Procesos recientes
                </h2>

                <Link href="/procesos" className="text-xs text-gold-600 hover:text-gold-700">
                  Ver todos
                </Link>
              </div>

              {stats.procesos_recientes?.length ? (
                <div className="space-y-3">
                  {stats.procesos_recientes.map((p: any) => (
                    <div
                      key={p.id}
                      onClick={() => router.push(`/procesos/${p.id}`)}
                      className="p-4 border border-numa-100 rounded-sm bg-numa-50 cursor-pointer hover:shadow-md transition-shadow duration-200"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-numa-800">
                            {p.codigo_proceso}
                          </p>

                          <p className="text-sm text-numa-600 mt-1">
                            {p.demandante} vs {p.demandado}
                          </p>

                          <p className="text-xs text-numa-400 mt-1">
                            {p.ciudad || '—'} · {p.sucursal || '—'}
                          </p>

                          {isAdmin && (
                            <p className="text-xs text-numa-400 mt-1">
                              Mediador: {p.usuario || '—'}
                            </p>
                          )}
                        </div>

                        <div className="text-right">
                          <Pill label={estadoLabel(p.estado)} {...estadoPill(p.estado)} />

                          <p className="text-xs text-numa-400 mt-2">
                            {p.fecha_creacion
                              ? new Date(p.fecha_creacion).toLocaleDateString('es-EC')
                              : '—'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  message="Todavía no tienes procesos registrados."
                  actionLabel="Crear tu primer proceso"
                  onAction={() => router.push('/procesos?crear=1')}
                />
              )}
            </div>

            <div className="card p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold text-numa-700 uppercase tracking-wider">
                  Actas finales recientes
                </h2>

                <Link href="/actas-finales" className="text-xs text-gold-600 hover:text-gold-700">
                  Ver todas
                </Link>
              </div>

              {stats.actas_recientes?.length ? (
                <div className="space-y-3">
                  {stats.actas_recientes.map((a: any) => (
                    <div
                      key={a.id}
                      onClick={() => router.push(`/procesos/${a.proceso_id}`)}
                      className="p-4 border border-numa-100 rounded-sm bg-numa-50 cursor-pointer hover:shadow-md transition-shadow duration-200"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-numa-800">
                            {a.codigo_acta}
                          </p>

                          <p className="text-sm text-numa-600 mt-1">
                            {a.demandante} vs {a.demandado}
                          </p>

                          <p className="text-xs text-numa-400 mt-1">
                            Proceso: {a.codigo_proceso}
                          </p>

                          <p className="text-xs text-numa-400 mt-1">
                            {a.ciudad || '—'} · {a.sucursal || '—'}
                          </p>

                          <p className="text-xs text-numa-400 mt-1">
                            Subida por: {a.subida_por || '—'}
                            {isAdmin && a.usuario && a.usuario !== a.subida_por
                              ? ` · Mediador del proceso: ${a.usuario}`
                              : ''}
                          </p>
                        </div>

                        <div className="text-right">
                          <Badge label="Finalizada" variant="aprobado" />

                          <p className="text-xs text-numa-400 mt-2">
                            {a.fecha_subida
                              ? new Date(a.fecha_subida).toLocaleDateString('es-EC')
                              : '—'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState message="Todavía no hay actas finales subidas." />
              )}
            </div>
          </div>

          <ResumenActasMes />

          {isAdmin && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold text-numa-700 uppercase tracking-wider flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-numa-400" />
                  Almacenamiento de archivos
                </h2>
              </div>

              {loadingAlmacenamiento ? (
                <Spinner />
              ) : !almacenamiento ? (
                <p className="text-sm text-numa-400">
                  No se pudo consultar el uso de almacenamiento en este momento.
                </p>
              ) : (
                <div>
                  <div className="flex items-end justify-between mb-2">
                    <p className="text-2xl font-bold text-numa-900">
                      {almacenamiento.total_mb} MB
                      <span className="text-sm font-normal text-numa-400 ml-1">
                        de {almacenamiento.limite_gb} GB
                      </span>
                    </p>

                    <p
                      className={`text-sm font-semibold ${
                        almacenamiento.porcentaje_usado >= 90
                          ? 'text-red-600'
                          : almacenamiento.porcentaje_usado >= 70
                          ? 'text-amber-600'
                          : 'text-numa-500'
                      }`}
                    >
                      {almacenamiento.porcentaje_usado}% usado
                    </p>
                  </div>

                  <div className="w-full h-2.5 bg-numa-100 rounded-full overflow-hidden mb-5">
                    <div
                      className={`h-full rounded-full ${
                        almacenamiento.porcentaje_usado >= 90
                          ? 'bg-red-500'
                          : almacenamiento.porcentaje_usado >= 70
                          ? 'bg-amber-500'
                          : 'bg-gold-400'
                      }`}
                      style={{ width: `${Math.min(almacenamiento.porcentaje_usado, 100)}%` }}
                    />
                  </div>

                  <p className="text-xs text-numa-400 mb-4">
                    {almacenamiento.total_archivos} archivo(s) en total
                  </p>

                  {almacenamiento.por_carpeta?.length > 0 && (
                    <div className="space-y-2">
                      {almacenamiento.por_carpeta.map((c: any) => (
                        <div
                          key={c.carpeta}
                          className="flex items-center justify-between text-sm border-t border-numa-100 pt-2"
                        >
                          <span className="text-numa-600">{c.carpeta}</span>
                          <span className="text-numa-800 font-medium">{c.mb} MB</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {isAdmin && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold text-numa-700 uppercase tracking-wider flex items-center gap-2">
                  <DatabaseBackup className="w-4 h-4 text-numa-400" />
                  Respaldo de la base de datos
                </h2>
              </div>

              <p className="text-sm text-numa-500 mb-4">
                Genera y envía por correo el mismo respaldo que el sistema manda automáticamente
                todos los días a las 3am — úsalo para confirmar ahora mismo si el envío está
                funcionando, sin esperar a la madrugada.
              </p>

              <button
                onClick={handleEnviarRespaldo}
                disabled={enviandoRespaldo}
                className="btn-primary text-sm px-4 py-2 disabled:opacity-60"
              >
                {enviandoRespaldo ? 'Enviando respaldo...' : 'Enviar respaldo ahora'}
              </button>

              {resultadoRespaldo && (
                <div
                  className={`mt-4 text-sm rounded-lg p-3 border ${
                    resultadoRespaldo.ok
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : 'bg-red-50 text-red-700 border-red-200'
                  }`}
                >
                  {resultadoRespaldo.mensaje}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        !error && (
          <div className="card p-10 text-center">
            <LayoutDashboard className="w-10 h-10 text-numa-200 mx-auto mb-3" />
            <p className="text-sm text-numa-400">Sin datos disponibles</p>
          </div>
        )
      )}
    </>
  );
}