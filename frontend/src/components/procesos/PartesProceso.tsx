'use client';

import { useEffect, useState } from 'react';
import { Plus, Star, X, Building2, User } from 'lucide-react';
import { Modal, SelectField, ErrorAlert, Spinner } from '@/components/ui';
import {
  getClientes,
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
}

const TITULOS: Record<Rol, string> = {
  solicitante: 'Solicitantes',
  invitado: 'Invitados'
};

export default function PartesProceso({ procesoId, editable, onCambio }: Props) {
  const [partes, setPartes] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const [rolAgregar, setRolAgregar] = useState<Rol | null>(null);
  const [clienteId, setClienteId] = useState('');
  const [empresaId, setEmpresaId] = useState('');
  const [guardando, setGuardando] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procesoId]);

  const mensajeError = (e: any, porDefecto: string) =>
    e?.response?.data?.detail || porDefecto;

  const abrirAgregar = (rol: Rol) => {
    setRolAgregar(rol);
    setClienteId('');
    setEmpresaId('');
    setError('');
  };

  const cerrarAgregar = () => {
    setRolAgregar(null);
    setError('');
  };

  const yaEnProceso = new Set(partes.map((p) => p.cliente_id));
  const disponibles = clientes.filter((c) => !yaEnProceso.has(c.id));
  const empresas = clientes.filter((c) => c.tipo === 'empresa');
  const elegido = clientes.find((c) => String(c.id) === clienteId);

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
        cliente_id: Number(clienteId),
        ...(empresaId ? { empresa_representada_id: Number(empresaId) } : {})
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
          <h3 className="text-xs font-semibold uppercase tracking-wide text-numa-500">
            {TITULOS[rol]}
          </h3>

          {editable && (
            <button
              type="button"
              onClick={() => abrirAgregar(rol)}
              className="btn-ghost text-xs py-1 px-2"
            >
              <Plus className="w-3 h-3" /> Agregar
            </button>
          )}
        </div>

        <ul className="space-y-2">
          {lista.map((p) => {
            const esEmpresa = p.tipo === 'empresa';

            return (
              <li
                key={p.id}
                className="border border-numa-100 rounded-sm px-3 py-2 bg-white flex items-start gap-2"
              >
                <span className="mt-0.5 text-numa-400 shrink-0">
                  {esEmpresa ? <Building2 className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </span>

                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-numa-900 break-words">
                    {p.nombre} {p.apellido}
                    {p.es_responsable && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gold-400/20 text-gold-700 align-middle">
                        <Star className="w-3 h-3" /> Responsable
                      </span>
                    )}
                  </p>

                  <p className="text-xs text-numa-500 code-text">
                    {esEmpresa ? `RUC ${p.ruc || '—'}` : `C.I. ${p.cedula || '—'}`}
                  </p>

                  {esEmpresa && p.representante_nombre && (
                    <p className="text-xs text-numa-500">
                      Representante legal: {p.representante_nombre}
                      {p.representante_cedula ? ` (C.I. ${p.representante_cedula})` : ''}
                    </p>
                  )}

                  {p.empresa_nombre && (
                    <p className="text-xs text-numa-500">
                      En representación de <strong>{p.empresa_nombre}</strong>
                      {p.empresa_ruc ? ` (RUC ${p.empresa_ruc})` : ''}
                    </p>
                  )}
                </div>

                {editable && (
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {!p.es_responsable && (
                      <>
                        <button
                          type="button"
                          onClick={() => hacerResponsable(p.id)}
                          className="text-[11px] text-numa-600 hover:text-gold-700 underline underline-offset-2"
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
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-numa-800">Partes del proceso</h2>
        {!editable && (
          <span className="text-[11px] text-numa-400">
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
        title={rolAgregar ? `Agregar ${rolAgregar}` : ''}
      >
        {error && rolAgregar && (
          <div className="mb-3">
            <ErrorAlert message={error} />
          </div>
        )}

        <div className="space-y-4">
          <SelectField
            label="Cliente"
            value={clienteId}
            onChange={(e) => {
              setClienteId(e.target.value);
              setEmpresaId('');
            }}
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

          {elegido && elegido.tipo !== 'empresa' && empresas.length > 0 && (
            <SelectField
              label="En representación de (opcional)"
              value={empresaId}
              onChange={(e) => setEmpresaId(e.target.value)}
            >
              <option value="">Actúa a título personal</option>
              {empresas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </SelectField>
          )}

          <p className="text-xs text-numa-400">
            Si la persona o empresa todavía no existe, créala primero en la sección
            &quot;Clientes&quot;.
          </p>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={cerrarAgregar} className="btn-secondary">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando} className="btn-primary">
            {guardando ? 'Guardando...' : 'Agregar'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
