'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  Modal,
  Spinner,
  EmptyState,
  InputField,
  PasswordField,
  SelectField,
  PageHeader,
  ErrorAlert,
  Badge,
  ConfirmDialog
} from '@/components/ui';
import {
  getUsuarios,
  createUsuario,
  updateUsuario,
  cambiarEstadoUsuario
} from '@/lib/services';
import { getSucursalesCached } from '@/lib/catalogCache';
import { isAdmin } from '@/lib/auth';

// Igual que en Clientes: cada avatar recibe un color distinto (siempre el
// mismo para el mismo usuario), de una paleta chica dentro de la marca, para
// que la tabla no se sienta tan gris.
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

const emptyForm = {
  nombre: '',
  apellido: '',
  cedula: '',
  email: '',
  telefono: '',
  password: '',
  rol: 'mediador',
  sucursal_id: ''
};

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cedulaError, setCedulaError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [enlaceActivacion, setEnlaceActivacion] = useState<{
    nombre: string;
    email: string;
    enlace: string | null;
    correoEnviado: boolean;
  } | null>(null);
  const [estadoTarget, setEstadoTarget] = useState<any | null>(null);
  const [changingEstado, setChangingEstado] = useState(false);
  const [search, setSearch] = useState('');

  // El atributo "title" (tooltip nativo) solo aparece al pasar el mouse —
  // en el teléfono no hay forma de verlo. El nombre completo también se
  // puede desplegar dando clic/toque: se guarda aquí el id del usuario
  // cuyo nombre está desplegado (uno solo a la vez).
  const [nombreExpandidoId, setNombreExpandidoId] = useState<number | null>(null);

  const admin = isAdmin();
  const router = useRouter();

  useEffect(() => {
    if (!admin) {
      router.replace('/dashboard');
    }
  }, [admin, router]);

  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    setLoading(true);
    setError('');

    try {
      const usuariosData = await getUsuarios();
      const sucursalesData = await getSucursalesCached();

      setUsuarios(usuariosData);
      setSucursales(sucursalesData);
    } catch (err) {
      console.error(err);
      setError('Error al cargar usuarios o sucursales');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  };

  const validarPassword = (password: string) => {
  return password.length >= 8;
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setCedulaError('');
    setEmailError('');
    setPasswordError('');
    setError('');
    setShowForm(true);
  };

  const openEdit = (u: any) => {
    setEditing(u);
    setForm({
      nombre: u.nombre || '',
      apellido: u.apellido || '',
      cedula: u.cedula || '',
      email: u.email || '',
      telefono: u.telefono || '',
      password: '',
      rol: u.rol || 'mediador',
      sucursal_id: u.sucursal_id ? String(u.sucursal_id) : ''
    });
    setCedulaError('');
    setEmailError('');
    setPasswordError('');
    setError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    setError('');
    setCedulaError('');
    setEmailError('');
    setPasswordError('');

    const faltantes = [
      !form.nombre.trim() && 'Nombre',
      !form.apellido.trim() && 'Apellido',
      !form.cedula.trim() && 'Cédula',
      !form.email.trim() && 'Email',
      !form.rol && 'Rol',
      !form.sucursal_id && 'Sucursal'
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

    if (!validarEmail(form.email)) {
      setEmailError('Ingresa un email válido');
      return;
    }

    if (form.telefono && form.telefono.length !== 10) {
      setError('El teléfono debe tener 10 dígitos (o déjalo en blanco)');
      return;
    }

    if (!editing && form.password.trim() && !validarPassword(form.password)) {
      setPasswordError('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    setSaving(true);

    try {
      if (editing) {
        const actualizado = await updateUsuario(editing.id, {
          nombre: form.nombre,
          apellido: form.apellido,
          cedula: form.cedula,
          email: form.email,
          telefono: form.telefono,
          rol: form.rol,
          sucursal_id: Number(form.sucursal_id)
        });

        // Se recarga la lista para que muestre de inmediato la sucursal y
        // los demás datos nuevos (la respuesta del guardado no trae el
        // nombre de la sucursal).
        load();
      } else {
        const creado = await createUsuario({
          nombre: form.nombre,
          apellido: form.apellido,
          cedula: form.cedula,
          email: form.email,
          telefono: form.telefono,
          password: form.password,
          rol: form.rol,
          sucursal_id: Number(form.sucursal_id)
        });

        // Mientras el correo no tenga un dominio propio verificado, el envío
        // automático puede no llegarle a cualquier destinatario. Por eso se
        // muestra aquí el enlace de activación, para poder copiarlo y
        // compartirlo manualmente (WhatsApp, etc.) si hace falta.
        if (creado?.enlace_activacion) {
          setEnlaceActivacion({
            nombre: `${form.nombre} ${form.apellido}`,
            email: form.email,
            enlace: creado.enlace_activacion,
            correoEnviado: !!creado.correo_enviado
          });
        }

        load();
      }

      setShowForm(false);
      setEditing(null);
      setForm(emptyForm);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Error al guardar el usuario';

      if (detail.toLowerCase().includes('cédula')) {
        setCedulaError(detail);
      } else if (detail.toLowerCase().includes('email')) {
        setEmailError(detail);
      } else {
        setError(detail);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCambiarEstado = async () => {
    if (!estadoTarget) return;

    setChangingEstado(true);
    setError('');

    try {
      const updated = await cambiarEstadoUsuario(
        estadoTarget.id,
        !estadoTarget.activo
      );

      setUsuarios((prev) =>
        prev.map((u) =>
          u.id === updated.id ? { ...u, activo: updated.activo } : u
        )
      );

      setEstadoTarget(null);
    } catch (err: any) {
      console.error(err);
      setError(err?.response?.data?.detail || 'Error al cambiar estado del usuario');
    } finally {
      setChangingEstado(false);
    }
  };

  const filtered = usuarios.filter((u) => {
    const q = search.toLowerCase();

    return (
      u.nombre?.toLowerCase().includes(q) ||
      u.apellido?.toLowerCase().includes(q) ||
      (u.cedula || '').includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.rol?.toLowerCase().includes(q) ||
      (u.sucursal || '').toLowerCase().includes(q) ||
      (u.ciudad || '').toLowerCase().includes(q)
    );
  });

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle="Gestión de usuarios del sistema"
        action={
          admin ? (
            <button onClick={openCreate} className="btn-primary">
              <Plus className="w-4 h-4" /> Nuevo Usuario
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
          placeholder="Buscar por nombre, cédula, email..."
          className="w-full pl-9 pr-4 py-2 border border-numa-200 rounded-full text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400 transition-all duration-200"
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
                : 'Todavía no hay usuarios registrados.'
            }
            actionLabel={search ? undefined : 'Crear el primer usuario'}
            onAction={search ? undefined : openCreate}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-numa-50 border-b border-numa-100">
                <tr>
                  <th className="table-header table-cell-sticky !bg-numa-50">Nombre</th>
                  <th className="table-header">Cédula</th>
                  <th className="table-header">Email</th>
                  <th className="table-header">Rol</th>
                  <th className="table-header">Sucursal</th>
                  <th className="table-header">Ciudad</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header">Fecha</th>
                  {admin && <th className="table-header">Acciones</th>}
                </tr>
              </thead>

              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="table-row">
                    <td className="table-cell table-cell-sticky font-medium max-w-[160px] sm:max-w-[220px]">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${getAvatarClass(
                            u.id
                          )}`}
                        >
                          <span className="text-xs font-bold">
                            {(u.nombre || '').charAt(0)}
                            {(u.apellido || '').charAt(0)}
                          </span>
                        </div>

                        <span
                          onClick={() =>
                            setNombreExpandidoId((prev) => (prev === u.id ? null : u.id))
                          }
                          className={`cursor-pointer ${
                            nombreExpandidoId === u.id
                              ? 'whitespace-normal break-words'
                              : 'block truncate'
                          }`}
                          title={`${u.nombre} ${u.apellido || ''}`}
                        >
                          {u.nombre} {u.apellido || ''}
                        </span>
                      </div>
                    </td>

                    <td className="table-cell text-numa-500">
                      {u.cedula || '—'}
                    </td>

                    <td className="table-cell text-numa-500">
                      {u.email}
                    </td>

                    <td className="table-cell">
                      <Badge
                        label={u.rol}
                        variant={u.rol === 'administrador' ? 'aprobado' : 'enviado'}
                      />
                    </td>

                    <td className="table-cell text-numa-600">
                      {u.sucursal || '—'}
                    </td>

                    <td className="table-cell text-numa-600">
                      {u.ciudad
                        ? `${u.ciudad}${u.provincia ? `, ${u.provincia}` : ''}`
                        : '—'}
                    </td>

                    <td className="table-cell">
                      <span
                        className={`badge ${
                          u.activo
                            ? 'bg-green-50 text-green-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {u.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>

                    <td className="table-cell text-numa-500">
                      {u.fecha_creacion
                        ? new Date(u.fecha_creacion).toLocaleDateString('es-EC')
                        : '—'}
                    </td>

                    {admin && (
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => openEdit(u)}
                            className="btn-ghost btn-sm flex items-center gap-1"
                          >
                            <Pencil className="w-3 h-3" /> Editar
                          </button>

                          <button
                            onClick={() => setEstadoTarget(u)}
                            className="btn-ghost btn-sm text-red-500 hover:text-red-700"
                          >
                            {u.activo ? 'Desactivar' : 'Reactivar'}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? 'Editar Usuario' : 'Nuevo Usuario'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField
              label="Nombres"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            />

            <InputField
              label="Apellidos"
              value={form.apellido}
              onChange={(e) => setForm({ ...form, apellido: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InputField
              label="Cédula"
              value={form.cedula}
              error={cedulaError}
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

            <InputField
              label="Email"
              value={form.email}
              error={emailError}
              onChange={(e) => {
                const value = e.target.value.trim();

                setForm({ ...form, email: value });

                if (value.length > 0 && !validarEmail(value)) {
                  setEmailError('Ingresa un email válido');
                } else {
                  setEmailError('');
                }
              }}
              placeholder="usuario@correo.com"
            />
          </div>

          <InputField
            label="Teléfono (opcional)"
            value={form.telefono}
            onChange={(e) =>
              setForm({ ...form, telefono: e.target.value.replace(/\D/g, '').slice(0, 10) })
            }
            placeholder="0991234567"
          />

          {!editing && (
            <>
              <PasswordField
                label="Contraseña (opcional)"
                value={form.password}
                error={passwordError}
                placeholder="Si la escribes, la persona entra directo con ella"
                onChange={(e) => {
                  const value = e.target.value;

                  setForm({ ...form, password: value });

                  if (value.length > 0 && value.length < 8) {
                    setPasswordError('La contraseña debe tener al menos 8 caracteres');
                  } else {
                    setPasswordError('');
                  }
                }}
              />

              <p className="text-xs text-numa-400 -mt-3">
                Si escribes una contraseña, la persona puede iniciar sesión de una
                vez con ella (recomendado por ahora, mientras el correo no tiene
                un dominio propio verificado). Si lo dejas en blanco, se le enviará
                un correo para que establezca su propia contraseña.
              </p>
            </>
          )}

          {editing && (
            <p className="text-xs text-numa-400">
              La contraseña no se edita aquí — el usuario puede cambiarla desde
              "Cambiar contraseña", o usar "¿Olvidaste tu contraseña?" en el login.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SelectField
              label="Rol"
              value={form.rol}
              onChange={(e) => setForm({ ...form, rol: e.target.value })}
            >
              <option value="mediador">Mediador</option>
              {/* Una sola secretaria activa por sucursal: si ya hay una, el
                  sistema avisa y pide suspenderla primero. */}
              {!(editing && editing.rol === 'administrador') && (
                <option value="secretaria">Secretaria</option>
              )}
              {/* El centro solo tiene un administrador (el actual). Al crear
                  un usuario nuevo no se puede elegir "Administrador"; esta
                  opción solo aparece al editar al administrador existente,
                  para no dejarlo sin rol válido en su propio formulario. */}
              {editing && editing.rol === 'administrador' && (
                <option value="administrador">Administrador</option>
              )}
            </SelectField>

            <SelectField
              label="Sucursal"
              value={form.sucursal_id}
              onChange={(e) => setForm({ ...form, sucursal_id: e.target.value })}
            >
              <option value="">Seleccione</option>
              {sucursales.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.nombre} - {s.ciudad}
                </option>
              ))}
            </SelectField>
          </div>
        </div>

        {/* El aviso va dentro del formulario: arriba de la página quedaba
            tapado por la ventana y no se veía por qué no se guardaba. */}
        {error && showForm && (
          <div className="mt-4">
            <ErrorAlert message={error} />
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setShowForm(false)} className="btn-secondary">
            Cancelar
          </button>

          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Guardando...' : editing ? 'Guardar Cambios' : 'Crear Usuario'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!estadoTarget}
        onClose={() => setEstadoTarget(null)}
        onConfirm={handleCambiarEstado}
        loading={changingEstado}
        confirmLabel={estadoTarget?.activo ? 'Desactivar' : 'Reactivar'}
        message={`¿Está seguro de ${
          estadoTarget?.activo ? 'desactivar' : 'reactivar'
        } al usuario "${estadoTarget?.email}"?`}
      />

      <Modal
        open={!!enlaceActivacion}
        onClose={() => setEnlaceActivacion(null)}
        title="Usuario creado"
        size="md"
      >
        {enlaceActivacion && (
          <div className="space-y-4">
            <p className="text-sm text-numa-700">
              Se creó la cuenta de <strong>{enlaceActivacion.nombre}</strong> (
              {enlaceActivacion.email}).
            </p>

            {enlaceActivacion.correoEnviado ? (
              <p className="text-sm text-green-700">
                El correo de bienvenida se envió correctamente.
              </p>
            ) : (
              <p className="text-sm text-amber-700">
                No se pudo confirmar el envío del correo (por ejemplo, si el
                proveedor de correo aún no tiene un dominio propio verificado).
                Copia este enlace y compártelo manualmente con la persona para
                que active su cuenta:
              </p>
            )}

            {enlaceActivacion.enlace && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={enlaceActivacion.enlace}
                  className="input-field text-xs"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm shrink-0"
                  onClick={() => {
                    navigator.clipboard?.writeText(enlaceActivacion.enlace || '');
                  }}
                >
                  Copiar
                </button>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                className="btn-primary"
                onClick={() => setEnlaceActivacion(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
