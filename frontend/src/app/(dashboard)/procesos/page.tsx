'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Check } from 'lucide-react';
import {
  PageHeader,
  Spinner,
  EmptyState,
  Modal,
  SelectField,
  TextareaField,
  InputField,
  ErrorAlert
} from '@/components/ui';

import {
  getProcesos,
  createProceso,
  getClientes
} from '@/lib/services';
import { getCiudadesCached, getSucursalesCached } from '@/lib/catalogCache';

import { isAdmin } from '@/lib/auth';

const getEstadoProcesoLabel = (estado: string) => {
  const labels: any = {
    en_negociacion: 'En negociación',
    cerrado_con_acuerdo: 'Cerrado con acuerdo',
    cerrado_sin_acuerdo: 'Cerrado sin acuerdo',
    archivado: 'Archivado',
    anulado: 'Anulado'
  };

  return labels[estado] || estado;
};

const getEstadoProcesoClass = (estado: string) => {
  const classes: any = {
    en_negociacion: 'bg-amber-50 text-amber-700',
    cerrado_con_acuerdo: 'bg-green-50 text-green-700',
    cerrado_sin_acuerdo: 'bg-red-50 text-red-700',
    archivado: 'bg-slate-100 text-slate-600',
    anulado: 'bg-slate-200 text-slate-500 line-through'
  };

  return classes[estado] || 'bg-numa-100 text-numa-600';
};

// Misma idea que el badge, pero como una franja de color a la izquierda de
// la tarjeta — así se distingue el estado de un proceso de un vistazo,
// sin tener que leer el texto del badge en cada tarjeta de la lista.
const getEstadoBorderClass = (estado: string) => {
  const classes: any = {
    en_negociacion: 'border-l-amber-400',
    cerrado_con_acuerdo: 'border-l-green-500',
    cerrado_sin_acuerdo: 'border-l-red-500',
    archivado: 'border-l-slate-300',
    anulado: 'border-l-slate-400'
  };

  return classes[estado] || 'border-l-numa-200';
};

export default function ProcesosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Permite llegar aquí con un filtro de estado ya aplicado, por ejemplo
  // desde las tarjetas del dashboard (/procesos?estado=cerrado_con_acuerdo).
  const estadoDesdeUrl = searchParams?.get('estado') || '';

  // Igual con la búsqueda: desde Clientes se llega con la cédula ya escrita
  // (/procesos?q=1712345675) para ver todos los procesos de esa persona.
  const busquedaDesdeUrl = searchParams?.get('q') || '';

  // Permite llegar aquí con la intención de crear de una vez, por ejemplo
  // desde el botón "Crear tu primer proceso" del dashboard cuando un
  // mediador nuevo todavía no tiene ningún proceso.
  const crearDesdeUrl = searchParams?.get('crear') === '1';

  const [procesos, setProcesos] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [ciudades, setCiudades] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);

  // El formulario de "Nuevo Proceso" se muestra como flujo por pasos, para
  // que un mediador nuevo no se enfrente a un formulario largo de una sola
  // vez: 1) partes involucradas, 2) tema, 3) confirmación con resumen.
  const PASOS_CREAR = [
    { numero: 1, titulo: 'Partes' },
    { numero: 2, titulo: 'Tema' },
    { numero: 3, titulo: 'Confirmar' }
  ] as const;
  const [paso, setPaso] = useState(1);

  const [filters, setFilters] = useState({
    q: busquedaDesdeUrl,
    estado: estadoDesdeUrl,
    ciudad_id: '',
    sucursal_id: '',
    fecha_desde: '',
    fecha_hasta: ''
  });

  const [form, setForm] = useState({
    cliente_demandante_id: '',
    cliente_demandado_id: '',
    empresa_solicitante_id: '',
    empresa_invitado_id: '',
    sucursal_id: '',
    tema: ''
  });

  const load = async () => {
    setLoading(true);

    try {
      const data = await getProcesos({
        q: filters.q || undefined,
        estado: filters.estado || undefined,
        ciudad_id: filters.ciudad_id || undefined,
        sucursal_id: filters.sucursal_id || undefined,
        fecha_desde: filters.fecha_desde || undefined,
        fecha_hasta: filters.fecha_hasta || undefined
      });

      setProcesos(data);
    } catch {
      setError('Error al cargar procesos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();

    getClientes().then(setClientes).catch(() => setClientes([]));
    getSucursalesCached().then(setSucursales).catch(() => setSucursales([]));
    getCiudadesCached(true).then(setCiudades).catch(() => setCiudades([]));

    if (crearDesdeUrl) abrirCrear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const limpiarFiltros = () => {
    setFilters({
      q: '',
      estado: '',
      ciudad_id: '',
      sucursal_id: '',
      fecha_desde: '',
      fecha_hasta: ''
    });

    getProcesos().then(setProcesos);
  };

  const abrirCrear = () => {
    setForm({
      cliente_demandante_id: '',
      cliente_demandado_id: '',
      empresa_solicitante_id: '',
      empresa_invitado_id: '',
      sucursal_id: '',
      tema: ''
    });
    setPaso(1);
    setError('');
    setShowCreate(true);
  };

  const cerrarCrear = () => {
    setShowCreate(false);
    setError('');
    setPaso(1);
  };

  // Paso 1: sucursal (solo admin) + solicitante + invitado.
  const validarPaso1 = () => {
    if (
      !form.cliente_demandante_id ||
      !form.cliente_demandado_id ||
      (isAdmin() && !form.sucursal_id)
    ) {
      setError('Completa sucursal, solicitante e invitado');
      return false;
    }

    if (form.cliente_demandante_id === form.cliente_demandado_id) {
      setError('Solicitante e invitado no pueden ser iguales');
      return false;
    }

    setError('');
    return true;
  };

  // Paso 2: tema del proceso.
  const validarPaso2 = () => {
    if (!form.tema.trim()) {
      setError('Describe el tema del proceso');
      return false;
    }

    setError('');
    return true;
  };

  const irSiguientePaso = () => {
    if (paso === 1 && !validarPaso1()) return;
    if (paso === 2 && !validarPaso2()) return;

    setPaso((p) => Math.min(p + 1, PASOS_CREAR.length));
  };

  const irPasoAnterior = () => {
    setError('');
    setPaso((p) => Math.max(p - 1, 1));
  };

  const etiquetaCliente = (c: any) =>
    c.tipo === 'empresa'
      ? `${c.nombre} (empresa · RUC ${c.ruc || '—'})`
      : `${c.nombre} ${c.apellido}`;

  const empresas = clientes.filter((c: any) => c.tipo === 'empresa');

  const esPersona = (id: string) =>
    !!id && clientes.find((c: any) => String(c.id) === String(id))?.tipo !== 'empresa';

  const nombreCliente = (id: string) =>
    clientes.find((c: any) => String(c.id) === String(id));

  const nombreSucursal = (id: string) =>
    sucursales.find((s: any) => String(s.id) === String(id));

  const handleCreate = async () => {
    setError('');

    // Si algo quedó incompleto (por ejemplo, se llegó aquí saltando pasos),
    // se regresa al paso correspondiente en vez de solo mostrar el error
    // con el usuario ya en el paso de confirmación.
    if (!validarPaso1()) {
      setPaso(1);
      return;
    }

    if (!validarPaso2()) {
      setPaso(2);
      return;
    }

    setSaving(true);

    try {
      const nuevoProceso = await createProceso({
        cliente_demandante_id: Number(form.cliente_demandante_id),
        cliente_demandado_id: Number(form.cliente_demandado_id),
        tema: form.tema,
        ...(form.empresa_solicitante_id
          ? { empresa_solicitante_id: Number(form.empresa_solicitante_id) }
          : {}),
        ...(form.empresa_invitado_id
          ? { empresa_invitado_id: Number(form.empresa_invitado_id) }
          : {}),
        ...(isAdmin() ? { sucursal_id: Number(form.sucursal_id) } : {})
      });

      setShowCreate(false);
      setPaso(1);

      setForm({
        cliente_demandante_id: '',
        cliente_demandado_id: '',
        empresa_solicitante_id: '',
        empresa_invitado_id: '',
        sucursal_id: '',
        tema: ''
      });

      // Se navega directo al proceso recién creado en vez de depender de
      // que el usuario lo encuentre y le dé clic en la lista: así se evita
      // el problema de que la fila nueva no respondiera al primer clic.
      if (nuevoProceso?.id) {
        router.push(`/procesos/${nuevoProceso.id}`);
      } else {
        load();
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Error al crear proceso');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Procesos de Mediación"
        subtitle="Gestión de procesos, invitaciones y avances"
        action={
          <button onClick={abrirCrear} className="btn-primary">
            <Plus className="w-4 h-4" />
            Nuevo Proceso
          </button>
        }
      />

      {error && !showCreate && (
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
          {/* Fila 1: buscar + los filtros de "dónde" / "qué estado" */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="xl:col-span-2">
              <InputField
                label="Buscar"
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                placeholder="Código, cliente, cédula o tema..."
              />
            </div>

            <SelectField
              label="Estado"
              value={filters.estado}
              onChange={(e) => setFilters({ ...filters, estado: e.target.value })}
            >
              <option value="">Todos</option>
              <option value="en_negociacion">En negociación</option>
              <option value="cerrado_con_acuerdo">Cerrado con acuerdo</option>
              <option value="cerrado_sin_acuerdo">Cerrado sin acuerdo</option>
              <option value="archivado">Archivado</option>
              <option value="anulado">Anulado</option>
            </SelectField>

            {isAdmin() && (
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

            {isAdmin() && (
              <SelectField
                label="Sucursal"
                value={filters.sucursal_id}
                onChange={(e) =>
                  setFilters({ ...filters, sucursal_id: e.target.value })
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
          </div>

          {/* Fila 2: las dos fechas juntas, lado a lado, y los botones —
              antes podían quedar una arriba y otra abajo según cuántos
              filtros de ciudad/sucursal se mostraran en la fila 1. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3 mt-3">
            <InputField
              label="Fecha desde"
              type="date"
              value={filters.fecha_desde}
              onChange={(e) =>
                setFilters({ ...filters, fecha_desde: e.target.value })
              }
            />

            <InputField
              label="Fecha hasta"
              type="date"
              value={filters.fecha_hasta}
              onChange={(e) =>
                setFilters({ ...filters, fecha_hasta: e.target.value })
              }
            />

            <div className="flex items-end gap-2">
              <button type="submit" className="btn-primary">
                Buscar
              </button>

              <button type="button" onClick={limpiarFiltros} className="btn-secondary">
                Limpiar
              </button>
            </div>
          </div>
        </form>
      </div>

      <div className="mb-3 text-sm text-numa-500">
        {loading ? (
          'Cargando procesos...'
        ) : (
          <>
            Mostrando <span className="font-semibold text-numa-800">{procesos.length}</span>{' '}
            {procesos.length === 1 ? 'proceso' : 'procesos'}
          </>
        )}
      </div>

      <div className="space-y-3">
        {loading ? (
          <Spinner />
        ) : procesos.length === 0 ? (
          <div className="card p-6">
            {(() => {
              const hayFiltrosActivos = Object.values(filters).some((v) => !!v);
              return (
                <EmptyState
                  message={
                    hayFiltrosActivos
                      ? 'No hay procesos que coincidan con estos filtros.'
                      : 'Todavía no tienes procesos registrados.'
                  }
                  actionLabel={hayFiltrosActivos ? undefined : 'Crear tu primer proceso'}
                  onAction={hayFiltrosActivos ? undefined : abrirCrear}
                />
              );
            })()}
          </div>
        ) : (
          procesos.map((p) => (
            <div
              key={p.id}
              onClick={() => router.push(`/procesos/${p.id}`)}
              className={`card p-4 border border-numa-100 border-l-4 ${getEstadoBorderClass(
                p.estado
              )} cursor-pointer hover:shadow-lg transition-shadow duration-200`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-numa-900">
                      {p.codigo_proceso}
                    </span>

                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${getEstadoProcesoClass(
                        p.estado
                      )}`}
                    >
                      {getEstadoProcesoLabel(p.estado)}
                    </span>

                    {/* Un proceso "cerrado con acuerdo" no significa que ya
                        esté todo listo: falta que se suba el acta final +
                        comprobante. Esto lo hace visible de una vez en el
                        listado, sin tener que entrar a cada proceso.
                        Además, si el mediador tiene más de un proceso
                        pendiente a la vez, se distingue cuál es el que debe
                        subir primero (fila FIFO) de los que están detrás
                        esperando su turno. */}
                    {p.estado === 'cerrado_con_acuerdo' && !p.finalizado && (
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${
                          p.acta_primero_en_fila
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : 'bg-numa-100 text-numa-500 border-numa-200'
                        }`}
                      >
                        {p.acta_primero_en_fila ? 'Falta subir acta' : 'Acta pendiente (en espera)'}
                      </span>
                    )}
                  </div>

                  <div className="text-sm text-numa-800">
                    {p.demandante}
                    {p.total_solicitantes > 1 && (
                      <span className="text-numa-400"> y {p.total_solicitantes - 1} más</span>
                    )}{' '}
                    vs {p.demandado}
                    {p.total_invitados > 1 && (
                      <span className="text-numa-400"> y {p.total_invitados - 1} más</span>
                    )}
                  </div>

                  <div className="text-xs text-numa-400 code-text">
                    {p.demandante_cedula || '—'} · {p.demandado_cedula || '—'}
                  </div>

                  <div className="text-xs text-numa-500">
                    {p.ciudad || '—'} · {p.sucursal || '—'}
                  </div>

                  <div className="text-xs text-numa-500">
                    Mediador: {p.usuario || '—'}
                  </div>

                  <div className="text-sm text-numa-700">Tema: {p.tema}</div>

                  <div className="text-xs text-numa-400">
                    Fecha:{' '}
                    {p.fecha_creacion
                      ? new Date(p.fecha_creacion).toLocaleDateString('es-EC')
                      : '—'}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/procesos/${p.id}`);
                  }}
                  className="btn-ghost text-xs py-1 px-2 shrink-0"
                >
                  {p.finalizado || p.estado === 'archivado'
                    ? 'Ver historial'
                    : 'Gestionar'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal open={showCreate} onClose={cerrarCrear} title="Nuevo Proceso de Mediación" size="lg">
        {/* Indicador de pasos: le muestra al mediador dónde está y qué falta,
            para que un formulario de varias secciones no se sienta como un
            solo bloque largo y confuso. */}
        <div className="flex items-center gap-2 mb-6">
          {PASOS_CREAR.map((p, idx) => (
            <div key={p.numero} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                    paso === p.numero
                      ? 'bg-gold-500 text-numa-950'
                      : paso > p.numero
                      ? 'bg-green-50 text-green-700'
                      : 'bg-numa-100 text-numa-400'
                  }`}
                >
                  {paso > p.numero ? <Check className="w-3.5 h-3.5" /> : p.numero}
                </div>

                <span
                  className={`text-xs font-medium hidden sm:inline ${
                    paso === p.numero ? 'text-numa-800' : 'text-numa-400'
                  }`}
                >
                  {p.titulo}
                </span>
              </div>

              {idx < PASOS_CREAR.length - 1 && (
                <div
                  className={`flex-1 h-px mx-3 ${
                    paso > p.numero ? 'bg-green-200' : 'bg-numa-100'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {error && showCreate && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}

        {paso === 1 && (
          <div className="space-y-4 animate-fade-in">
            <p className="text-xs text-numa-500">
              Paso 1 de {PASOS_CREAR.length}: elige quiénes participan en el proceso.
            </p>

            {isAdmin() && (
              <SelectField
                label="Sucursal"
                value={form.sucursal_id}
                onChange={(e) => setForm({ ...form, sucursal_id: e.target.value })}
              >
                <option value="">Seleccione una sucursal</option>

                {sucursales.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.ciudad_nombre || s.ciudad || ''} - {s.nombre}
                  </option>
                ))}
              </SelectField>
            )}

            <SelectField
              label="Solicitante"
              value={form.cliente_demandante_id}
              onChange={(e) =>
                setForm({ ...form, cliente_demandante_id: e.target.value })
              }
            >
              <option value="">Seleccione</option>

              {clientes.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {etiquetaCliente(c)}
                </option>
              ))}
            </SelectField>

            {esPersona(form.cliente_demandante_id) && empresas.length > 0 && (
              <SelectField
                label="Solicitante: en representación de (opcional)"
                value={form.empresa_solicitante_id}
                onChange={(e) =>
                  setForm({ ...form, empresa_solicitante_id: e.target.value })
                }
              >
                <option value="">Actúa a título personal</option>
                {empresas.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </SelectField>
            )}

            <SelectField
              label="Invitado"
              value={form.cliente_demandado_id}
              onChange={(e) =>
                setForm({ ...form, cliente_demandado_id: e.target.value })
              }
            >
              <option value="">Seleccione</option>

              {clientes.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {etiquetaCliente(c)}
                </option>
              ))}
            </SelectField>

            {esPersona(form.cliente_demandado_id) && empresas.length > 0 && (
              <SelectField
                label="Invitado: en representación de (opcional)"
                value={form.empresa_invitado_id}
                onChange={(e) =>
                  setForm({ ...form, empresa_invitado_id: e.target.value })
                }
              >
                <option value="">Actúa a título personal</option>
                {empresas.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </SelectField>
            )}

            {clientes.length === 0 && (
              <p className="text-xs text-numa-400">
                Todavía no hay clientes registrados. Ve a &quot;Clientes&quot; para
                registrar al solicitante y al invitado antes de continuar.
              </p>
            )}
          </div>
        )}

        {paso === 2 && (
          <div className="space-y-4 animate-fade-in">
            <p className="text-xs text-numa-500">
              Paso 2 de {PASOS_CREAR.length}: describe el motivo del proceso.
            </p>

            <TextareaField
              label="Tema / Motivo del proceso"
              rows={5}
              value={form.tema}
              onChange={(e) => setForm({ ...form, tema: e.target.value })}
              placeholder="Ejemplo: Mediación por acuerdo de pago..."
            />
          </div>
        )}

        {paso === 3 && (
          <div className="space-y-4 animate-fade-in">
            <p className="text-xs text-numa-500">
              Paso 3 de {PASOS_CREAR.length}: revisa los datos antes de crear el proceso.
            </p>

            <div className="card bg-numa-50 p-4 space-y-2 text-sm">
              {isAdmin() && (
                <div>
                  <span className="text-numa-400">Sucursal: </span>
                  <span className="font-medium text-numa-800">
                    {nombreSucursal(form.sucursal_id)?.nombre || '—'}
                  </span>
                </div>
              )}

              <div>
                <span className="text-numa-400">Solicitante: </span>
                <span className="font-medium text-numa-800">
                  {nombreCliente(form.cliente_demandante_id)?.nombre}{' '}
                  {nombreCliente(form.cliente_demandante_id)?.apellido}
                  {form.empresa_solicitante_id &&
                    ` — en representación de ${nombreCliente(form.empresa_solicitante_id)?.nombre}`}
                </span>
              </div>

              <div>
                <span className="text-numa-400">Invitado: </span>
                <span className="font-medium text-numa-800">
                  {nombreCliente(form.cliente_demandado_id)?.nombre}{' '}
                  {nombreCliente(form.cliente_demandado_id)?.apellido}
                  {form.empresa_invitado_id &&
                    ` — en representación de ${nombreCliente(form.empresa_invitado_id)?.nombre}`}
                </span>
              </div>

              <div>
                <span className="text-numa-400">Tema: </span>
                <span className="text-numa-700">{form.tema}</span>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-sm p-3">
              <p className="text-xs text-blue-700">
                Al crear el proceso irás directo a su pantalla, donde podrás
                agendar invitaciones, registrar avances y, cuando se cierre,
                subir el acta final.
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-between gap-3 mt-6">
          <div>
            {paso > 1 && (
              <button onClick={irPasoAnterior} className="btn-secondary">
                Atrás
              </button>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={cerrarCrear} className="btn-secondary">
              Cancelar
            </button>

            {paso < PASOS_CREAR.length ? (
              <button onClick={irSiguientePaso} className="btn-primary">
                Siguiente
              </button>
            ) : (
              <button onClick={handleCreate} disabled={saving} className="btn-primary">
                {saving ? 'Guardando...' : 'Crear Proceso'}
              </button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
