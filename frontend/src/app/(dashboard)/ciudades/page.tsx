'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  Modal,
  Spinner,
  EmptyState,
  InputField,
  SelectField,
  PageHeader,
  ErrorAlert
} from '@/components/ui';
import {
  getCiudades,
  createCiudad,
  updateCiudad,
  getProvincias
} from '@/lib/services';
import { invalidateCiudadesCache } from '@/lib/catalogCache';
import { Ciudad } from '@/types';
import { isAdmin } from '@/lib/auth';

const empty = {
  nombre: '',
  provincia_id: '',
  prefijo: ''
};


export default function CiudadesPage() {
  const [ciudades, setCiudades] = useState<Ciudad[]>([]);
  const [provincias, setProvincias] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const admin = isAdmin();

  const router = useRouter();
  useEffect(() => {
  if (!admin) {
    router.replace('/dashboard');
  }
}, [admin, router]);

  const load = async () => {
    setLoading(true);
    setError('');

    try {
      const [ciudadesData, provinciasData] = await Promise.all([
        getCiudades(),
        getProvincias()
      ]);

      setCiudades(ciudadesData);
      setProvincias(provinciasData);
    } catch {
      setError('Error al cargar ciudades');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setShowForm(true);
  };

  const openEdit = (c: any) => {
    setEditing(c);
    setForm({
      nombre: c.nombre || '',
      provincia_id: c.provincia_id ? String(c.provincia_id) : '',
      prefijo: c.prefijo || ''
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(empty);
  };

  const handleSave = async () => {
    setError('');

    if (!form.nombre.trim() || !form.provincia_id || !form.prefijo.trim()) {
      setError('Completa todos los campos');
      return;
    }

    setSaving(true);

    try {
      const payload = {
        nombre: form.nombre.trim(),
        provincia_id: Number(form.provincia_id),
        prefijo: form.prefijo.trim().toUpperCase()
      };

      if (editing) {
        const updated = await updateCiudad(editing.id, payload as any);
        setCiudades((prev) =>
          prev.map((c: any) => (c.id === updated.id ? updated : c))
        );
      } else {
        await createCiudad(payload);
      }

      invalidateCiudadesCache();

      closeForm();
      load();
    } catch (err: any) {
      console.error(err);

      setError(
        err?.response?.data?.detail ||
        'Error al guardar ciudad'
      );
    }
      finally {
      setSaving(false);
    }
  };

const ciudadesFiltradas = ciudades.filter((c: any) => {
  const texto = `${c.nombre} ${c.provincia} ${c.prefijo}`.toLowerCase();
  return texto.includes(search.toLowerCase());
});

 return (
   <>
    <PageHeader
      title="Ciudades"
      subtitle="Catálogo oficial de ciudades/cantones del Ecuador"
    />
    
    <div className="mb-4 relative max-w-sm">
      <Search className="w-4 h-4 text-numa-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar ciudad, provincia o prefijo..."
        className="w-full pl-9 pr-4 py-2 border border-numa-200 rounded-full text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400 transition-all duration-200"
      />
    </div>


      <div className="card overflow-hidden">
        {loading ? (
          <Spinner />
        ) : ciudades.length === 0 ? (
          <EmptyState message="No hay ciudades registradas." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-numa-50 border-b border-numa-100">
                <tr>
                  <th className="table-header">#</th>
                  <th className="table-header">Nombre</th>
                  <th className="table-header">Provincia</th>
                  <th className="table-header">Prefijo</th>
                  <th className="table-header">Acciones</th>
                </tr>
              </thead>

              <tbody>
                {ciudadesFiltradas.map((c: any) => {
                  return (
                    <tr key={c.id} className="table-row">
                      <td className="table-cell text-numa-400">{c.id}</td>
                      <td className="table-cell font-medium">{c.nombre}</td>
                      <td className="table-cell">{c.provincia || '—'}</td>
                      <td className="table-cell">{c.prefijo || '—'}</td>

                      <td className="table-cell">
                        {admin && (
                          <button
                            onClick={() => openEdit(c)}
                            className="btn-ghost text-xs py-1 px-2"
                          >
                            <Pencil className="w-3 h-3" /> Editar
                          </button>
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
        title={editing ? 'Editar Ciudad' : 'Nueva Ciudad'}
        size="sm"
      >
        {error && (
                <div className="mb-4">
                  <ErrorAlert message={error} />
                </div>
        )}

        <div className="space-y-4">
          <SelectField
            label="Provincia"
            value={form.provincia_id}
            onChange={(e) =>
              setForm({ ...form, provincia_id: e.target.value })
            }
          >
            <option value="">Seleccione una provincia</option>
            {provincias.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </SelectField>

          <InputField
            label="Nombre de la ciudad"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            placeholder="Guayaquil"
          />

          <InputField
            label="Prefijo"
            value={form.prefijo}
            onChange={(e) =>
              setForm({ ...form, prefijo: e.target.value.toUpperCase() })
            }
            placeholder="GYE"
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
  </>
  );
}