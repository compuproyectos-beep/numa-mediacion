'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Search } from 'lucide-react';
import {
  Modal, Spinner, EmptyState,
  InputField, SelectField, PageHeader, ErrorAlert
} from '@/components/ui';
import {
  getClientes,
  createCliente,
  updateCliente,
  getProvincias
} from '@/lib/services';
import { getCiudadesCached } from '@/lib/catalogCache';
import { getUser } from '@/lib/auth';
import { Cliente, CreateClientePayload } from '@/types';

// Para que la lista de clientes no se sienta tan plana/gris, cada avatar
// recibe un color distinto (siempre el mismo para el mismo cliente), de
// una paleta chica dentro de la marca.
const AVATAR_COLORS = [
  'bg-gold-400/20 text-gold-700',
  'bg-numa-700 text-white',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700'
];

const getAvatarClass = (id: number | string) => {
  const n = Number(id) || 0;
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
};

const empty: CreateClientePayload = {
  tipo: 'persona',
  razon_social: '',
  ruc: '',
  representante_nombre: '',
  representante_cedula: '',
  nombre: '',
  apellido: '',
  cedula: '',
  email: '',
  telefono: '',
  ciudad_id: undefined,
  direccion: ''
};

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [ciudades, setCiudades] = useState<any[]>([]);
  const [provincias, setProvincias] = useState<any[]>([]);
  const [provinciaId, setProvinciaId] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cedulaError, setCedulaError] = useState('');
  const [rucError, setRucError] = useState('');
  const [repCedulaError, setRepCedulaError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [telefonoError, setTelefonoError] = useState('');
  const [search, setSearch] = useState('');

  // El atributo "title" (el tooltip nativo del navegador) solo aparece al
  // pasar el mouse por encima — en el teléfono, donde no hay mouse, nunca
  // se ve. Por eso el nombre completo también se puede desplegar dando
  // clic/toque: se guarda aquí el id del cliente cuyo nombre está
  // desplegado (uno solo a la vez).
  const [nombreExpandidoId, setNombreExpandidoId] = useState<number | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Cliente | null>(null);
  // La secretaria solo corrige datos de contacto: nombre y cédula salen en actas y reportes.
  const soloContacto = !!editing && getUser()?.rol === 'secretaria';
  const [form, setForm] = useState<CreateClientePayload>(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getClientes(), getCiudadesCached(), getProvincias()])
      .then(([clientesData, ciudadesData, provinciasData]) => {
        setClientes(clientesData);
        setCiudades(ciudadesData);
        setProvincias(provinciasData);
      })
      .catch(() => setError('Error al cargar clientes'))
      .finally(() => setLoading(false));
  }, []);

  const ciudadesFiltradas = ciudades.filter(
    (c) => String(c.provincia_id) === String(provinciaId)
  );

  const validarCedula = (cedula: string) => {
    if (!/^\d{10}$/.test(cedula)) return false;

    const provincia = parseInt(cedula.slice(0, 2), 10);
    if (provincia < 1 || provincia > 24) return false;

    const tercerDigito = parseInt(cedula[2], 10);
    if (tercerDigito >= 6) return false;

    const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
    let suma = 0;

    for (let i = 0; i < 9; i++) {
      let valor = parseInt(cedula[i], 10) * coeficientes[i];
      if (valor >= 10) valor -= 9;
      suma += valor;
    }

    const digitoVerificador = (10 - (suma % 10)) % 10;

    return digitoVerificador === parseInt(cedula[9], 10);
  };

  const validarEmail = (email: string) => {
    if (!email) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  };

  const validarTelefono = (telefono: string) => {
    if (!telefono) return true;
    return /^\d{10}$/.test(telefono);
  };

  const filtered = clientes.filter((c) => {
    const q = search.toLowerCase();

    return (
      c.nombre.toLowerCase().includes(q) ||
      c.apellido.toLowerCase().includes(q) ||
      (c.cedula || '').includes(q) ||
      (c.ruc || '').includes(q) ||
      (c.representante_nombre || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.telefono || '').includes(q) ||
      (c.ciudad || '').toLowerCase().includes(q) ||
      (c.provincia || '').toLowerCase().includes(q) ||
      (c.direccion || '').toLowerCase().includes(q)
    );
  });

  const openCreate = () => {
    setEditing(null);
    setProvinciaId('');
    setForm(empty);
    setError('');
    setCedulaError('');
    setRucError('');
    setRepCedulaError('');
    setEmailError('');
    setTelefonoError('');
    setShowForm(true);
  };

  const openEdit = (c: Cliente) => {
    const ciudad = ciudades.find(
      (ciudad) => Number(ciudad.id) === Number(c.ciudad_id)
    );

    setEditing(c);
    setProvinciaId(ciudad?.provincia_id ? String(ciudad.provincia_id) : '');

    setForm({
      tipo: c.tipo || 'persona',
      razon_social: c.razon_social || '',
      ruc: c.ruc || '',
      representante_nombre: c.representante_nombre || '',
      representante_cedula: c.representante_cedula || '',
      nombre: c.nombre || '',
      apellido: c.apellido || '',
      cedula: c.cedula || '',
      email: c.email || '',
      telefono: c.telefono || '',
      ciudad_id: c.ciudad_id,
      direccion: c.direccion || ''
    });

    setError('');
    setCedulaError('');
    setRucError('');
    setRepCedulaError('');
    setEmailError('');
    setTelefonoError('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setProvinciaId('');
    setForm(empty);
    setError('');
    setCedulaError('');
    setEmailError('');
    setTelefonoError('');
  };

  const handleSave = async () => {
    setError('');
    setCedulaError('');
    setEmailError('');
    setTelefonoError('');

    const esEmpresa = form.tipo === 'empresa';

    if (esEmpresa) {
      const faltantesEmpresa = [
        !form.razon_social?.trim() && 'Razón social',
        !form.representante_nombre?.trim() && 'Nombre del representante legal'
      ].filter(Boolean);

      if (faltantesEmpresa.length > 0) {
        setError(`No se puede guardar: falta completar ${faltantesEmpresa.join(', ')}.`);
        return;
      }
      if (!/^\d{13}$/.test(form.ruc || '')) {
        setRucError('El RUC debe tener 13 dígitos');
        return;
      }
      if (!validarCedula(form.representante_cedula || '')) {
        setRepCedulaError('Cédula del representante inválida');
        return;
      }
    } else {
      const faltantes = [
        !form.nombre.trim() && 'Nombre',
        !form.apellido.trim() && 'Apellido',
        !form.cedula.trim() && 'Cédula'
      ].filter(Boolean);

      if (faltantes.length > 0) {
        setError(`No se puede guardar: falta completar ${faltantes.join(', ')}.`);
        return;
      }

      if (!validarCedula(form.cedula)) {
        setCedulaError(
          form.cedula.length !== 10
            ? 'La cédula debe tener 10 dígitos'
            : 'Cédula ecuatoriana inválida'
        );
        return;
      }
    }

    if (!validarEmail(form.email)) {
      setEmailError('Ingresa un email válido');
      return;
    }

    if (!validarTelefono(form.telefono)) {
      setTelefonoError('El teléfono debe tener 10 dígitos');
      return;
    }

    setSaving(true);

    try {
      if (editing) {
        await updateCliente(editing.id, form);
      } else {
        await createCliente(form);
      }

      const clientesActualizados = await getClientes();
      setClientes(clientesActualizados);

      closeForm();
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail ||
        'Error al guardar cliente';

      if (detail.toLowerCase().includes('ruc')) {
        setRucError(detail);
      } else if (detail.toLowerCase().includes('cédula')) {
        setCedulaError(detail);
      } else {
        setError(detail);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Gestión de clientes y participantes"
        action={
          <button onClick={openCreate} className="btn-primary">
            <Plus className="w-4 h-4" /> Nuevo Cliente
          </button>
        }
      />

      {error && !showForm && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}

      <div className="mb-3 relative max-w-sm">
        <Search className="w-4 h-4 text-numa-600 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, cédula, ciudad..."
          className="w-full pl-9 pr-4 py-1.5 border border-numa-200 rounded-full text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400 transition-all duration-200"
        />
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <EmptyState
            message={
              search
                ? 'No se encontraron resultados.'
                : 'Todavía no hay clientes registrados.'
            }
            actionLabel={search ? undefined : 'Registrar tu primer cliente'}
            onAction={search ? undefined : openCreate}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-numa-50 border-b border-numa-100">
                <tr>
                  <th className="table-header table-cell-sticky !bg-numa-50">Nombre</th>
                  <th className="table-header">Cédula / RUC</th>
                  <th className="table-header">Email</th>
                  <th className="table-header">Teléfono</th>
                  <th className="table-header">Ciudad domicilio</th>
                  <th className="table-header">Dirección</th>
                  <th className="table-header table-cell-sticky-right !bg-numa-50">Acciones</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="table-row">
                    <td className="table-cell table-cell-sticky max-w-[160px] sm:max-w-[220px]">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${getAvatarClass(
                            c.id
                          )}`}
                        >
                          <span className="text-xs font-bold">
                            {c.tipo === 'empresa'
                              ? c.nombre.slice(0, 2).toUpperCase()
                              : `${c.nombre.charAt(0)}${c.apellido.charAt(0)}`}
                          </span>
                        </div>

                        <p
                          onClick={() =>
                            setNombreExpandidoId((prev) => (prev === c.id ? null : c.id))
                          }
                          className={`font-medium text-numa-900 cursor-pointer ${
                            nombreExpandidoId === c.id ? 'whitespace-normal break-words' : 'truncate'
                          }`}
                          title={`${c.nombre} ${c.apellido}`}
                        >
                          {c.nombre} {c.apellido}
                          {c.tipo === 'empresa' && (
                            <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gold-400/20 text-gold-700">
                              Empresa
                            </span>
                          )}
                        </p>
                      </div>
                    </td>

                    <td className="table-cell text-numa-700 code-text">
                      {c.tipo === 'empresa' ? `RUC ${c.ruc || '—'}` : c.cedula}
                    </td>
                    <td className="table-cell text-numa-700">{c.email || '—'}</td>
                    <td className="table-cell text-numa-700">{c.telefono || '—'}</td>
                    <td className="table-cell text-numa-700">
                      {c.ciudad || '—'}
                    </td>
                    <td
                      className="table-cell text-numa-700 max-w-xs truncate"
                      title={c.direccion || undefined}
                    >
                      {c.direccion || '—'}
                    </td>

                    <td className="table-cell table-cell-sticky-right">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(c)}
                          className="btn-ghost btn-sm"
                        >
                          <Pencil className="w-3 h-3" /> Editar
                        </button>

                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={showForm}
        onClose={closeForm}
        title={editing ? 'Editar Cliente' : 'Nuevo Cliente'}
        size="lg"
      >
        {error && showForm && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}

        {soloContacto && (
          <p className="mb-4 text-xs text-numa-700 bg-numa-50 border border-numa-200 rounded-sm p-3">
            Puedes corregir teléfono, correo, dirección y ciudad. Para cambiar el nombre o la cédula
            pide ayuda a un mediador o al administrador, porque salen en las actas.
          </p>
        )}

        {!editing && (
          <div className="mb-4 flex gap-2">
            {(['persona', 'empresa'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setForm({ ...form, tipo: t });
                  setError('');
                }}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  form.tipo === t
                    ? 'bg-numa-900 text-white border-numa-900'
                    : 'bg-white text-numa-600 border-numa-200 hover:border-gold-400'
                }`}
              >
                {t === 'persona' ? 'Persona natural' : 'Empresa o institución'}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {form.tipo === 'empresa' ? (
            <>
              <div className="col-span-2">
                <InputField
                  label="Razón social"
                  disabled={soloContacto}
                  value={form.razon_social || ''}
                  onChange={(e) => setForm({ ...form, razon_social: e.target.value })}
                  placeholder="Comercial Ejemplo S.A."
                />
              </div>

              <div>
                <InputField
                  label="RUC"
                  disabled={soloContacto}
                  value={form.ruc || ''}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 13);
                    setForm({ ...form, ruc: value });
                    setRucError(
                      value.length > 0 && value.length < 13 ? 'El RUC debe tener 13 dígitos' : ''
                    );
                  }}
                  placeholder="1790000000001"
                />
                {rucError && <p className="text-xs text-red-500 mt-1">{rucError}</p>}
              </div>

              <div />

              <InputField
                label="Representante legal (nombre completo)"
                disabled={soloContacto}
                value={form.representante_nombre || ''}
                onChange={(e) => setForm({ ...form, representante_nombre: e.target.value })}
                placeholder="Juan Pérez"
              />

              <div>
                <InputField
                  label="Cédula del representante"
                  disabled={soloContacto}
                  value={form.representante_cedula || ''}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 10);
                    setForm({ ...form, representante_cedula: value });
                    if (value.length > 0 && value.length < 10) {
                      setRepCedulaError('La cédula debe tener 10 dígitos');
                    } else if (value.length === 10 && !validarCedula(value)) {
                      setRepCedulaError('Cédula ecuatoriana inválida');
                    } else {
                      setRepCedulaError('');
                    }
                  }}
                  placeholder="0923456789"
                />
                {repCedulaError && <p className="text-xs text-red-500 mt-1">{repCedulaError}</p>}
              </div>
            </>
          ) : (
            <>
              <InputField
                label="Nombres"
                disabled={soloContacto}
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder="Juan"
              />

              <InputField
                label="Apellidos"
                disabled={soloContacto}
                value={form.apellido}
                onChange={(e) => setForm({ ...form, apellido: e.target.value })}
                placeholder="Pérez"
              />

              <div>
                <InputField
                  label="Cédula"
                  disabled={soloContacto}
                  value={form.cedula}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 10);
                    setForm({ ...form, cedula: value });

                    if (value.length > 0 && value.length < 10) {
                      setCedulaError('La cédula debe tener 10 dígitos');
                    } else if (value.length === 10 && !validarCedula(value)) {
                      setCedulaError('Cédula ecuatoriana inválida');
                    } else {
                      setCedulaError('');
                    }
                  }}
                  placeholder="0923456789"
                />

                {cedulaError && (
                  <p className="text-xs text-red-500 mt-1">{cedulaError}</p>
                )}
              </div>
            </>
          )}

          <div>
            <InputField
              label={form.tipo === 'empresa' ? 'Teléfono de la empresa' : 'Teléfono'}
              value={form.telefono}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 10);
                setForm({ ...form, telefono: value });

                if (value.length > 0 && value.length < 10) {
                  setTelefonoError('El teléfono debe tener 10 dígitos');
                } else {
                  setTelefonoError('');
                }
              }}
              placeholder="0999999999"
            />

            {telefonoError && (
              <p className="text-xs text-red-500 mt-1">
                {telefonoError}
              </p>
            )}
          </div>

          <div className="col-span-2">
            <InputField
              label={form.tipo === 'empresa' ? 'Correo de la empresa' : 'Email'}
              value={form.email}
              onChange={(e) => {
                const value = e.target.value.trim();
                setForm({ ...form, email: value });

                if (value.length > 0 && !validarEmail(value)) {
                  setEmailError('Ingresa un email válido');
                } else {
                  setEmailError('');
                }
              }}
              placeholder="cliente@correo.com"
            />

            {emailError && (
              <p className="text-xs text-red-500 mt-1">
                {emailError}
              </p>
            )}
          </div>

          <SelectField
            label={form.tipo === 'empresa' ? 'Provincia de la empresa' : 'Provincia domicilio'}
            value={provinciaId}
            onChange={(e) => {
              setProvinciaId(e.target.value);
              setForm({ ...form, ciudad_id: undefined });
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
            label={form.tipo === 'empresa' ? 'Ciudad de la empresa' : 'Ciudad de domicilio'}
            value={form.ciudad_id || ''}
            onChange={(e) =>
              setForm({
                ...form,
                ciudad_id: e.target.value
                  ? Number(e.target.value)
                  : undefined
              })
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

          <div className="col-span-2">
            <InputField
              label={form.tipo === 'empresa' ? 'Dirección de la empresa' : 'Dirección domiciliaria'}
              value={form.direccion || ''}
              onChange={(e) =>
                setForm({ ...form, direccion: e.target.value })
              }
              placeholder="Av. Principal y calle secundaria"
            />
          </div>
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