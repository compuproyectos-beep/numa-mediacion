'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Building2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  Modal, Spinner, EmptyState, ConfirmDialog,
  InputField, SelectField, PageHeader, ErrorAlert
} from '@/components/ui';
import {
  getSucursales,
  createSucursal,
  updateSucursal,
  cambiarEstadoSucursal,
  getCiudades,
  getProvincias
} from '@/lib/services';
import { invalidateSucursalesCache } from '@/lib/catalogCache';
import { Sucursal, Ciudad, CreateSucursalPayload } from '@/types';
import { isAdmin } from '@/lib/auth';

const empty: CreateSucursalPayload = {
  nombre: '',
  direccion: '',
  telefono: '',
  ciudad_id: 0
};


export default function SucursalesPage() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [ciudades, setCiudades] = useState<any[]>([]);
  const [provincias, setProvincias] = useState<any[]>([]);
  const [provinciaId, setProvinciaId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Sucursal | null>(null);
  const [form, setForm] = useState<CreateSucursalPayload>(empty);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  // El atributo "title" (tooltip nativo) solo aparece al pasar el mouse —
  // en el teléfono no hay forma de verlo. El nombre completo también se
  // puede desplegar dando clic/toque: se guarda aquí el id de la sucursal
  // cuyo nombre está desplegado (uno solo a la vez).
  const [nombreExpandidoId, setNombreExpandidoId] = useState<number | null>(null);

const [estadoTarget, setEstadoTarget] = useState<any | null>(null);
const [changingEstado, setChangingEstado] = useState(false);

  const admin = isAdmin();

    const router = useRouter();
  useEffect(() => {
  if (!admin) {
    router.replace('/dashboard');
  }
  }, [admin, router]);

  useEffect(() => {
    Promise.all([getSucursales(), getCiudades(), getProvincias()])
      .then(([s, c, p]) => {
        setSucursales(s);
        setCiudades(c);
        setProvincias(p);
      })
      .catch(() => setError('Error al cargar datos'))
      .finally(() => setLoading(false));
  }, []);

  const ciudadesFiltradas = ciudades.filter(
    (c) => String(c.provincia_id) === String(provinciaId)
  );

   const openCreate = () => {
    setEditing(null);
    setProvinciaId('');
    setForm(empty);
    setShowForm(true);
  };

  const openEdit = (s: any) => {
    const ciudad = ciudades.find((c) => Number(c.id) === Number(s.ciudad_id));

    setEditing(s);
    setProvinciaId(ciudad?.provincia_id ? String(ciudad.provincia_id) : '');

    setForm({
      nombre: s.nombre || '',
      direccion: s.direccion || '',
      telefono: s.telefono || '',
      ciudad_id: s.ciudad_id || 0
    });

    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setProvinciaId('');
    setForm(empty);
  };

 const handleSave = async () => {
  setError('');

  if (!form.nombre.trim() || !provinciaId || !form.ciudad_id) {
    setError('Completa provincia, ciudad y nombre de sucursal');
    return;
  }

  if (form.telefono && form.telefono.length !== 10) {
    setError('El teléfono debe tener 10 dígitos');
    return;
  }

  setSaving(true);

  try {
    if (editing) {
      const updated = await updateSucursal(editing.id, form);
      setSucursales((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      );
    } else {
      const nueva = await createSucursal(form);
      setSucursales((prev) => [nueva, ...prev]);
    }

    invalidateSucursalesCache();

    closeForm();
  } catch (err: any) {
    console.error(err);

    setError(
      err?.response?.data?.detail ||
      'Error al guardar sucursal'
    );
  } finally {
    setSaving(false);
  }
};

const handleCambiarEstado = async () => {
  if (!estadoTarget) return;

  setChangingEstado(true);

  try {
    const activoActual = estadoTarget.activo ?? estadoTarget.activa;

    const updated = await cambiarEstadoSucursal(
      estadoTarget.id,
      !activoActual
    );

    setSucursales((prev) =>
      prev.map((s: any) => (s.id === updated.id ? updated : s))
    );

    invalidateSucursalesCache();

    setEstadoTarget(null);
  } catch {
    setError('Error al cambiar estado de sucursal');
  } finally {
    setChangingEstado(false);
  }
};

  const getCiudadNombre = (id: number) =>
    ciudades.find((c) => Number(c.id) === Number(id))?.nombre ?? '—';

  const getProvinciaNombre = (ciudadId: number) => {
    const ciudad = ciudades.find((c) => Number(c.id) === Number(ciudadId));
    const provincia = provincias.find(
      (p) => Number(p.id) === Number(ciudad?.provincia_id)
    );

    return provincia?.nombre ?? ciudad?.provincia ?? '—';
  };

 const sucursalesFiltradas = sucursales.filter((s: any) => {
  const texto = `
    ${s.nombre}
    ${s.ciudad_nombre || s.ciudad || ''}
    ${getProvinciaNombre(s.ciudad_id)}
    ${s.telefono || ''}
  `.toLowerCase();

  return texto.includes(search.toLowerCase());
  });

  return (
    <>
      <PageHeader
        title="Sucursales"
        subtitle="Gestión de sucursales del centro"
        action={
          admin ? (
            <button onClick={openCreate} className="btn-primary">
              <Plus className="w-4 h-4" /> Nueva Sucursal
            </button>
          ) : null
        }
      />

      {error && !showForm && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}

      <div className="mb-4 relative max-w-sm">
        <Search className="w-4 h-4 text-numa-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar sucursal, ciudad, provincia..."
          className="w-full pl-9 pr-4 py-2 border border-numa-200 rounded-full text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400 transition-all duration-200"
        />
      </div>

      <div className="card overflow-hidden">
        {loading ? <Spinner /> : sucursales.length === 0 ? (
          <EmptyState
            message={
              search
                ? 'No se encontraron resultados.'
                : 'Todavía no hay sucursales registradas.'
            }
            actionLabel={search ? undefined : 'Crear la primera sucursal'}
            onAction={search ? undefined : openCreate}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-numa-50 border-b border-numa-100">
                <tr>
                  <th className="table-header table-cell-sticky !bg-numa-50">Nombre</th>
                  <th className="table-header">Provincia</th>
                  <th className="table-header">Ciudad</th>
                  <th className="table-header">Código</th>
                  <th className="table-header">Dirección</th>
                  <th className="table-header">Teléfono</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header">Acciones</th>
                </tr>
              </thead>

              <tbody>
                {sucursalesFiltradas.map((s: any) => {
                  const activa = s.activo ?? s.activa;

                  return (
                    <tr key={s.id} className="table-row">
                      <td className="table-cell table-cell-sticky max-w-[160px] sm:max-w-[240px]">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-numa-400 shrink-0" />
                          <span
                            onClick={() =>
                              setNombreExpandidoId((prev) => (prev === s.id ? null : s.id))
                            }
                            className={`font-medium cursor-pointer ${
                              nombreExpandidoId === s.id
                                ? 'whitespace-normal break-words'
                                : 'block truncate'
                            }`}
                            title={s.nombre}
                          >
                            {s.nombre}
                          </span>
                        </div>
                      </td>

                      <td className="table-cell">
                        {getProvinciaNombre(s.ciudad_id)}
                      </td>

                      <td className="table-cell">
                        {s.ciudad_nombre ?? s.ciudad ?? getCiudadNombre(s.ciudad_id)}
                      </td>

                      <td className="table-cell font-medium text-numa-700">
                        {s.codigo_corto || '—'}
                      </td>

                      <td className="table-cell text-numa-500 max-w-xs truncate">
                        {s.direccion || '—'}
                      </td>

                      <td className="table-cell text-numa-500">
                        {s.telefono || '—'}
                      </td>

                      <td className="table-cell">
                        <span className={`badge ${activa ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                          {activa ? 'Activa' : 'Inactiva'}
                        </span>
                      </td>

                      <td className="table-cell">
                        {admin && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => openEdit(s)}
                              className="btn-ghost btn-sm"
                            >
                              <Pencil className="w-3 h-3" /> Editar
                            </button>

                            <button
                              onClick={() => setEstadoTarget(s)}
                               className="btn-ghost btn-sm text-red-500 hover:text-red-700"
                            >
                                {(s.activo ?? s.activa) ? 'Desactivar' : 'Reactivar'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={showForm}
        onClose={closeForm}
        title={editing ? 'Editar Sucursal' : 'Nueva Sucursal'}
      >

        {error && showForm && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}

        <div className="space-y-4">
          <SelectField
            label="Provincia"
            value={provinciaId}
            onChange={(e) => {
              setProvinciaId(e.target.value);
              setForm({ ...form, ciudad_id: 0 });
            }}
          >
            <option value="">Seleccione una provincia</option>
            {provincias.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Ciudad"
            value={form.ciudad_id}
            onChange={(e) =>
              setForm({ ...form, ciudad_id: Number(e.target.value) })
            }
            disabled={!provinciaId}
          >
            <option value="">Seleccione una ciudad</option>
            {ciudadesFiltradas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </SelectField>

          <InputField
            label="Nombre"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            placeholder="Sucursal Norte"
          />

          <InputField
            label="Dirección"
            value={form.direccion}
            onChange={(e) => setForm({ ...form, direccion: e.target.value })}
            placeholder="Av. Principal 123"
          />

          <InputField
            label="Teléfono"
            value={form.telefono}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, '').slice(0, 10);
              setForm({ ...form, telefono: value });
            }}
            placeholder="0981790092"
          />
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={closeForm} className="btn-secondary">
            Cancelar
          </button>

          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </Modal>

     <ConfirmDialog
         open={!!estadoTarget}
         onClose={() => setEstadoTarget(null)}
         onConfirm={handleCambiarEstado}
          loading={changingEstado}
          confirmLabel={
          estadoTarget && (estadoTarget.activo ?? estadoTarget.activa)
         ? 'Desactivar'
         : 'Reactivar'
             }
                   message={`¿Está seguro de ${
          estadoTarget && (estadoTarget.activo ?? estadoTarget.activa)
           ? 'desactivar'
           : 'reactivar'
       } la sucursal "${estadoTarget?.nombre}"?`}
      />
    </>
  );
}