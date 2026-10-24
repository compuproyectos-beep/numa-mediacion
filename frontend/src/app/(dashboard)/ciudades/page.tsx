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

// Para que la tabla no se sienta tan gris/plana, el prefijo de cada ciudad
// se muestra como una pastilla de color (siempre el mismo color para la
// misma ciudad), de una paleta chica dentro de la marca.
const BADGE_COLORS = [
  'bg-gold-400/15 text-gold-700 border-gold-400/30',
  'bg-numa-700/10 text-numa-700 border-numa-700/20',
  'bg-emerald-50 text-emerald-700 border-emerald-200',
  'bg-sky-50 text-sky-700 border-sky-200',
  'bg-rose-50 text-rose-700 border-rose-200',
  'bg-violet-50 text-violet-700 border-violet-200'
];

const getBadgeClass = (id: number | string) => {
  const n = Number(id) || 0;
  return BADGE_COLORS[n % BADGE_COLORS.length];
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

  // El atributo "title" (tooltip nativo) solo aparece al pasar el mouse —
  // en el teléfono no hay forma de verlo. El nombre completo también se
  // puede desplegar dando clic/toque: se guarda aquí el id de la ciudad
  // cuyo nombre está desplegado (uno solo a la vez).
  const [nombreExpandidoId, setNombreExpandidoId] = useState<number | null>(null);

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

    const faltantes = [
      !form.nombre.trim() && 'Nombre',
      !form.provincia_id && 'Provincia',
      !form.prefijo.trim() && 'Prefijo'
    ].filter(Boolean);

    if (faltantes.length > 0) {
      setError(`No se puede guardar: falta completar ${faltantes.join(', ')}.`);
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
    
    <div className="mb-3 relative max-w-sm">
      <Search className="w-4 h-4 text-numa-600 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar ciudad, provincia o prefijo..."
        className="w-full pl-9 pr-4 py-1.5 border border-numa-200 rounded-full text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400 transition-all duration-200"
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
                  <th className="table-header table-cell-sticky !bg-numa-50">Nombre</th>
                  <th className="table-header">Provincia</th>
                  <th className="table-header">Prefijo</th>
                  <th className="table-header table-cell-sticky-right !bg-numa-50">Acciones</th>
                </tr>
              </thead>

              <tbody>
                {ciudadesFiltradas.map((c: any) => {
                  return (
                    <tr key={c.id} className="table-row">
                      <td className="table-cell text-numa-600 code-text">{c.id}</td>
                      <td className="table-cell table-cell-sticky font-medium max-w-[140px] sm:max-w-[220px]">
                        <span
                          onClick={() =>
                            setNombreExpandidoId((prev) => (prev === c.id ? null : c.id))
                          }
                          className={`cursor-pointer ${
                            nombreExpandidoId === c.id
                              ? 'whitespace-normal break-words'
                              : 'block truncate'
                          }`}
                          title={c.nombre}
                        >
                          {c.nombre}
                        </span>
                      </td>
                      <td className="table-cell text-numa-600">{c.provincia || '—'}</td>
                      <td className="table-cell">
                        {c.prefijo ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border code-text ${getBadgeClass(
                              c.id
                            )}`}
                          >
                            {c.prefijo}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>

                      <td className="table-cell table-cell-sticky-right">
                        {admin && (
                          <button
                            onClick={() => openEdit(c)}
                            className="btn-ghost btn-sm"
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