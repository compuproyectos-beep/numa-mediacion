'use client';

import { useEffect, useState } from 'react';
import { Plus, Star, X, Building2, User, Users } from 'lucide-react';
import { getCiudadesCached } from '@/lib/catalogCache';
import { Modal, SelectField, InputField, ErrorAlert, Spinner } from '@/components/ui';
import {
  getClientes,
  createCliente,
  getProvincias,
  getPartesProceso,
  agregarParteProceso,
  cambiarResponsableParte,
  quitarParteProceso
} from '@/lib/services';

type Rol = 'solicitante' | 'invitado';

interface Props {
  procesoId: number;
  // Solo se pueden cambiar las partes mientras el proceso sigue en negociación.
  editable: boolean;
  // Se llama cuando cambia el responsable (el encabezado del proceso lo muestra).
  onCambio?: () => void;
  // Datos del proceso (tema, apertura…) que se muestran arriba, en la misma tarjeta.
  resumen?: React.ReactNode;
}

const TITULOS: Record<Rol, string> = {
  solicitante: 'Solicitantes',
  invitado: 'Invitados'
};

export default function PartesProceso({ procesoId, editable, onCambio, resumen }: Props) {
  const [partes, setPartes] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const [rolAgregar, setRolAgregar] = useState<Rol | null>(null);
  const [clienteId, setClienteId] = useState('');
  // Qué se agrega: una persona o una empresa/institución. Así la lista no mezcla
  // los dos tipos y no se elige una empresa por error.
  const [tipoParte, setTipoParte] = useState<'persona' | 'empresa'>('persona');
  const [guardando, setGuardando] = useState(false);

  // Crear un cliente nuevo sin salir de esta ventana.
  const VACIO = {
    nombre: '',
    apellido: '',
    cedula: '',
    telefono: '',
    razon_social: '',
    ruc: '',
    representante_nombre: '',
    representante_cedula: '',
    email: '',
    direccion: ''
  };
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState(VACIO);
  const [creandoGuardando, setCreandoGuardando] = useState(false);
  const [provincias, setProvincias] = useState<any[]>([]);
  const [ciudades, setCiudades] = useState<any[]>([]);
  const [provinciaId, setProvinciaId] = useState('');
  const [ciudadId, setCiudadId] = useState('');
  const campoNuevo = (k: keyof typeof VACIO, soloNumeros = 0) => ({
    value: nuevo[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setNuevo({
        ...nuevo,
        [k]: soloNumeros ? e.target.value.replace(/\D/g, '').slice(0, soloNumeros) : e.target.value
      })
  });

  const guardarNuevoCliente = async () => {
    setError('');
    if (nuevo.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nuevo.email)) {
      setError('Ingresa un email válido');
      return;
    }
    setCreandoGuardando(true);
    try {
      const esEmpresa = tipoParte === 'empresa';
      const c: any = await createCliente(
        (esEmpresa
          ? {
              tipo: 'empresa',
              razon_social: nuevo.razon_social,
              ruc: nuevo.ruc,
              representante_nombre: nuevo.representante_nombre,
              representante_cedula: nuevo.representante_cedula,
              telefono: nuevo.telefono || undefined,
              email: nuevo.email || undefined,
              direccion: nuevo.direccion || undefined,
              ciudad_id: ciudadId ? Number(ciudadId) : undefined
            }
          : {
              tipo: 'persona',
              nombre: nuevo.nombre,
              apellido: nuevo.apellido,
              cedula: nuevo.cedula,
              telefono: nuevo.telefono || undefined,
              email: nuevo.email || undefined,
              direccion: nuevo.direccion || undefined,
              ciudad_id: ciudadId ? Number(ciudadId) : undefined
            }) as any
      );
      // El cliente nuevo queda en la lista y ya elegido.
      setClientes((prev) => [...prev, c]);
      setClienteId(String(c.id));
      setCreando(false);
      setNuevo(VACIO);
      setProvinciaId('');
      setCiudadId('');
    } catch (e: any) {
      setError(mensajeError(e, 'No se pudo crear el cliente'));
    } finally {
      setCreandoGuardando(false);
    }
  };

  const cargar = async () => {
    try {
      setPartes(await getPartesProceso(procesoId));
    } catch {
      setError('No se pudieron cargar las partes del proceso');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargar();
    getClientes().then(setClientes).catch(() => setClientes([]));
    getProvincias().then(setProvincias).catch(() => setProvincias([]));
    getCiudadesCached().then(setCiudades).catch(() => setCiudades([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procesoId]);

  const mensajeError = (e: any, porDefecto: string) =>
    e?.response?.data?.detail || porDefecto;

  const abrirAgregar = (rol: Rol) => {
    setRolAgregar(rol);
    setClienteId('');
    setTipoParte('persona');
    setCreando(false);
    setNuevo(VACIO);
    setProvinciaId('');
    setCiudadId('');
    setError('');
  };

  const cerrarAgregar = () => {
    setRolAgregar(null);
    setCreando(false);
    setError('');
  };

  const yaEnProceso = new Set(partes.map((p) => p.cliente_id));
  const disponibles = clientes.filter(
    (c) => !yaEnProceso.has(c.id) && (tipoParte === 'empresa' ? c.tipo === 'empresa' : c.tipo !== 'empresa')
  );

  // Regla de cada lado: o solo personas naturales, o UNA sola empresa con
  // todas las demás personas como sus miembros. Como todo proceso ya tiene
  // a alguien en cada lado, aquí solo se agregan personas (miembros de la
  // empresa o personas a título personal). El servidor vuelve a comprobarlo.
  const ladoActual = partes.filter((p) => p.rol === rolAgregar);
  const empresaDelLado = ladoActual.find((p) => p.tipo === 'empresa');

  const guardar = async () => {
    if (!rolAgregar || !clienteId) {
      setError('Elige a quién agregar');
      return;
    }

    setGuardando(true);
    setError('');

    try {
      const nuevas = await agregarParteProceso(procesoId, {
        rol: rolAgregar,
        cliente_id: Number(clienteId)
      });
      setPartes(nuevas);
      setRolAgregar(null);
      onCambio?.();
    } catch (e: any) {
      setError(mensajeError(e, 'No se pudo agregar'));
    } finally {
      setGuardando(false);
    }
  };

  const hacerResponsable = async (parteId: number) => {
    setError('');
    try {
      setPartes(await cambiarResponsableParte(procesoId, parteId));
      onCambio?.();
    } catch (e: any) {
      setError(mensajeError(e, 'No se pudo cambiar el responsable'));
    }
  };

  const quitar = async (parteId: number) => {
    setError('');
    try {
      setPartes(await quitarParteProceso(procesoId, parteId));
      onCambio?.();
    } catch (e: any) {
      setError(mensajeError(e, 'No se pudo quitar'));
    }
  };

  const columna = (rol: Rol) => {
    const lista = partes.filter((p) => p.rol === rol);

    return (
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-numa-800">
            {TITULOS[rol]}
          </h3>

          {editable && (
            <button
              type="button"
              onClick={() => abrirAgregar(rol)}
              className="btn-secondary btn-sm"
            >
              <Plus className="w-3.5 h-3.5" /> {rol === 'solicitante' ? 'Agregar solicitante' : 'Agregar invitado'}
            </button>
          )}
        </div>

        <ul className="space-y-2">
          {lista.map((p) => {
            const esEmpresa = p.tipo === 'empresa';

            return (
              <li
                key={p.id}
                className="rounded-lg px-3.5 py-3 bg-white border border-numa-200 flex items-start gap-2"
              >
                <span className="mt-0.5 text-numa-700 shrink-0">
                  {esEmpresa ? <Building2 className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </span>

                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-numa-900 break-words">
                    {p.nombre} {p.apellido}
                    {p.es_responsable && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gold-400/20 text-gold-700 align-middle">
                        <Star className="w-3 h-3" /> Responsable
                      </span>
                    )}
                  </p>

                  <p className="text-xs text-numa-800 code-text">
                    {esEmpresa ? `RUC ${p.ruc || '—'}` : `C.I. ${p.cedula || '—'}`}
                  </p>

                  {esEmpresa && p.representante_nombre && (
                    <p className="text-xs text-numa-800">
                      Representante legal: {p.representante_nombre}
                      {p.representante_cedula ? ` (C.I. ${p.representante_cedula})` : ''}
                    </p>
                  )}

                  {p.empresa_nombre && (
                    <p className="text-xs text-numa-800">
                      Miembro de <strong>{p.empresa_nombre}</strong>
                      {p.empresa_ruc ? ` (RUC ${p.empresa_ruc})` : ''}
                    </p>
                  )}

                  {/* Solo informativo en pantalla: no se imprime. */}
                  <p className="text-[11px] italic text-numa-700">
                    {esEmpresa || p.empresa_nombre ? 'A título jurídico' : 'A título personal'}
                  </p>
                </div>

                {editable && (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {!p.es_responsable && (
                      <>
                        <button
                          type="button"
                          onClick={() => hacerResponsable(p.id)}
                          className="text-[11px] text-numa-700 hover:text-gold-700 underline underline-offset-2"
                        >
                          Hacer responsable
                        </button>
                        <button
                          type="button"
                          onClick={() => quitar(p.id)}
                          className="text-[11px] text-red-600 hover:text-red-700 inline-flex items-center gap-0.5"
                        >
                          <X className="w-3 h-3" /> Quitar
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <div className="card p-4 mb-4">
      {resumen}
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-numa-900">
          <Users className="w-5 h-5 text-numa-700" aria-hidden="true" />
          Partes del proceso
        </h2>
        {!editable && (
          <span className="text-[11px] text-numa-700">
            Ya no se pueden modificar (el proceso no está en negociación)
          </span>
        )}
      </div>

      {error && !rolAgregar && (
        <div className="mb-3">
          <ErrorAlert message={error} />
        </div>
      )}

      {cargando ? (
        <Spinner />
      ) : (
        <div className="flex flex-col md:flex-row gap-4">
          {columna('solicitante')}
          {columna('invitado')}
        </div>
      )}

      <Modal
        open={rolAgregar !== null}
        onClose={cerrarAgregar}
        size="lg"
        title={rolAgregar ? `Agregar ${rolAgregar}` : ''}
      >
        {error && rolAgregar && (
          <div className="mb-3">
            <ErrorAlert message={error} />
          </div>
        )}

        <div className="space-y-4">
          {ladoActual.length === 0 && (
          <div className="inline-flex rounded-md border border-numa-200 bg-white p-0.5 text-xs font-semibold">
            {(
              [
                ['persona', 'Persona natural'],
                ['empresa', 'Empresa o institución']
              ] as const
            ).map(([clave, texto]) => (
              <button
                key={clave}
                type="button"
                onClick={() => {
                  setTipoParte(clave);
                  setClienteId('');
                              setCreando(false);
                  setNuevo(VACIO);
                }}
                className={`px-3 py-1 rounded ${
                  tipoParte === clave ? 'bg-[#144193] text-white' : 'text-numa-700 hover:bg-numa-50'
                }`}
              >
                {texto}
              </button>
            ))}
          </div>
          )}

          {ladoActual.length > 0 && (
            <p className="text-xs rounded-md border border-numa-200 bg-numa-50 text-numa-700 px-3 py-2">
              {empresaDelLado ? (
                <>
                  Este lado tiene una empresa (<strong>{empresaDelLado.nombre}</strong>): la persona
                  que agregues será <strong>miembro de la empresa</strong>. No se puede agregar otra
                  empresa ni personas a título personal.
                </>
              ) : (
                <>
                  Este lado tiene personas naturales: solo se pueden agregar más personas naturales.
                  No se puede mezclar con una empresa.
                </>
              )}
            </p>
          )}

          {!creando && (
            <>
          <SelectField
            label={tipoParte === 'empresa' ? 'Empresa o institución' : 'Persona'}
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value)}
          >
            <option value="">Seleccione</option>
            {disponibles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.tipo === 'empresa'
                  ? `${c.nombre} (empresa · RUC ${c.ruc || '—'})`
                  : `${c.nombre} ${c.apellido}`}
              </option>
            ))}
          </SelectField>
              <button
                type="button"
                onClick={() => {
                  setCreando(true);
                  setClienteId('');
                              setError('');
                }}
                className="text-xs font-semibold text-gold-600 hover:text-gold-700 -mt-2"
              >
                + {tipoParte === 'empresa' ? 'Nueva empresa' : 'Nueva persona'} (si no está en la lista)
              </button>
            </>
          )}

          {creando && (
            <div className="rounded-md border border-gold-300 bg-gold-50/40 p-3 space-y-3">
              <p className="text-xs font-semibold text-numa-800">
                {tipoParte === 'empresa' ? 'Nueva empresa o institución' : 'Nueva persona natural'}
              </p>

              {tipoParte === 'empresa' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <InputField label="Razón social" {...campoNuevo('razon_social')} />
                  </div>
                  <InputField label="RUC (13 dígitos)" {...campoNuevo('ruc', 13)} />
                  <InputField label="Teléfono (opcional)" {...campoNuevo('telefono', 10)} />
                  <InputField
                    label="Representante legal"
                    {...campoNuevo('representante_nombre')}
                  />
                  <InputField
                    label="Cédula del representante (opcional)"
                    {...campoNuevo('representante_cedula', 10)}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Nombres" {...campoNuevo('nombre')} />
                  <InputField label="Apellidos" {...campoNuevo('apellido')} />
                  <InputField label="Cédula" {...campoNuevo('cedula', 10)} />
                  <InputField label="Teléfono (opcional)" {...campoNuevo('telefono', 10)} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <InputField
                    label="Email (opcional)"
                    placeholder="cliente@correo.com"
                    {...campoNuevo('email')}
                  />
                </div>
                <SelectField
                  label="Provincia de domicilio"
                  value={provinciaId}
                  onChange={(e) => {
                    setProvinciaId(e.target.value);
                    setCiudadId('');
                  }}
                >
                  <option value="">Seleccione</option>
                  {provincias.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="Ciudad de domicilio"
                  value={ciudadId}
                  onChange={(e) => setCiudadId(e.target.value)}
                  disabled={!provinciaId}
                >
                  <option value="">Seleccione</option>
                  {ciudades
                    .filter((c: any) => String(c.provincia_id) === String(provinciaId))
                    .map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                </SelectField>
                <div className="col-span-2">
                  <InputField
                    label="Dirección domiciliaria (opcional)"
                    placeholder="Av. Principal y calle secundaria"
                    {...campoNuevo('direccion')}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCreando(false);
                    setNuevo(VACIO);
                    setError('');
                  }}
                  className="btn-secondary btn-sm"
                >
                  Volver a la lista
                </button>
                <button
                  type="button"
                  onClick={guardarNuevoCliente}
                  disabled={creandoGuardando}
                  className="btn-primary btn-sm"
                >
                  {creandoGuardando ? 'Guardando...' : 'Guardar cliente'}
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-numa-700">
            El cliente nuevo queda guardado también en la sección &quot;Clientes&quot;.
          </p>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={cerrarAgregar} className="btn-secondary">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando || creando} className="btn-primary">
            {guardando ? 'Guardando...' : 'Agregar'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
