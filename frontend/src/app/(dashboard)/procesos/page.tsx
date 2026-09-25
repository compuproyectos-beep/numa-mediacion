'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
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
    archivado: 'Archivado'
  };

  return labels[estado] || estado;
};

const getEstadoProcesoClass = (estado: string) => {
  const classes: any = {
    en_negociacion: 'bg-amber-50 text-amber-700',
    cerrado_con_acuerdo: 'bg-green-50 text-green-700',
    cerrado_sin_acuerdo: 'bg-red-50 text-red-700',
    archivado: 'bg-slate-100 text-slate-600'
  };

  return classes[estado] || 'bg-numa-100 text-numa-600';
};

export default function ProcesosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Permite llegar aquí con un filtro de estado ya aplicado, por ejemplo
  // desde las tarjetas del dashboard (/procesos?estado=cerrado_con_acuerdo).
  const estadoDesdeUrl = searchParams?.get('estado') || '';

  const [procesos, setProcesos] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [ciudades, setCiudades] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);

  const [filters, setFilters] = useState({
    q: '',
    estado: estadoDesdeUrl,
    ciudad_id: '',
    sucursal_id: '',
    fecha_desde: '',
    fecha_hasta: ''
  });

  const [form, setForm] = useState({
    cliente_demandante_id: '',
    cliente_demandado_id: '',
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

  const handleCreate = async () => {
    setError('');

    if (
      !form.cliente_demandante_id ||
      !form.cliente_demandado_id ||
      !form.tema.trim() ||
      (isAdmin() && !form.sucursal_id)
    ) {
      setError('Completa todos los campos obligatorios');
      return;
    }

    if (form.cliente_demandante_id === form.cliente_demandado_id) {
      setError('Solicitante e invitado no pueden ser iguales');
      return;
    }

    setSaving(true);

    try {
      const nuevoProceso = await createProceso({
        cliente_demandante_id: Number(form.cliente_demandante_id),
        cliente_demandado_id: Number(form.cliente_demandado_id),
        tema: form.tema,
        ...(isAdmin() ? { sucursal_id: Number(form.sucursal_id) } : {})
      });

      setShowCreate(false);

      setForm({
        cliente_demandante_id: '',
        cliente_demandado_id: '',
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
          <button onClick={() => setShowCreate(true)} className="btn-primary">
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
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
            <button onClick={load} className="btn-primary">
              Buscar
            </button>

            <button onClick={limpiarFiltros} className="btn-secondary">
              Limpiar
            </button>
          </div>
        </div>
      </div>

      <div className="mb-3 text-sm text-numa-500">
        Mostrando <span className="font-semibold text-numa-800">{procesos.length}</span>{' '}
        {procesos.length === 1 ? 'proceso' : 'procesos'}
      </div>

      <div className="space-y-3">
        {loading ? (
          <Spinner />
        ) : procesos.length === 0 ? (
          <div className="card p-6">
            <EmptyState message="No hay procesos registrados." />
          </div>
        ) : (
          procesos.map((p) => (
            <div
              key={p.id}
              onClick={() => router.push(`/procesos/${p.id}`)}
              className="card p-4 border border-numa-100 cursor-pointer hover:shadow-lg transition-shadow duration-200"
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
                  </div>

                  <div className="text-sm text-numa-800">
                    {p.demandante} vs {p.demandado}
                  </div>

                  <div className="text-xs text-numa-400 code-text">
                    {p.demandante_cedula} · {p.demandado_cedula}
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

      <Modal
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          setError('');
        }}
        title="Nuevo Proceso de Mediación"
        size="lg"
      >
        {error && showCreate && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}

        <div className="space-y-4">
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
                {c.nombre} {c.apellido}
              </option>
            ))}
          </SelectField>

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
                {c.nombre} {c.apellido}
              </option>
            ))}
          </SelectField>

          <TextareaField
            label="Tema / Motivo del proceso"
            rows={4}
            value={form.tema}
            onChange={(e) => setForm({ ...form, tema: e.target.value })}
            placeholder="Ejemplo: Mediación por acuerdo de pago..."
          />
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setShowCreate(false)} className="btn-secondary">
            Cancelar
          </button>

          <button onClick={handleCreate} disabled={saving} className="btn-primary">
            {saving ? 'Guardando...' : 'Crear Proceso'}
          </button>
        </div>
      </Modal>
    </>
  );
}
