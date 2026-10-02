'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import {
  PageHeader,
  SelectField,
  TextareaField,
  Spinner,
  EmptyState,
  ErrorAlert,
  SuccessAlert
} from '@/components/ui';
import CalendarioAgendaMediador from '@/components/citas/CalendarioAgendaMediador';
import { getUsuarios, getProcesos, crearInvitacionProceso } from '@/lib/services';
import { useAuth } from '@/hooks/useAuth';

export default function AgendaPage() {
  const { user, isAdmin, isLoading: loadingUser } = useAuth();

  const [mediadores, setMediadores] = useState<any[]>([]);
  const [loadingMediadores, setLoadingMediadores] = useState(isAdmin);
  const [mediadorSeleccionadoId, setMediadorSeleccionadoId] = useState('');

  // Procesos que se pueden elegir para agendarles una invitación nueva:
  // en negociación y sin otra invitación ya pendiente.
  const [procesos, setProcesos] = useState<any[]>([]);
  const [loadingProcesos, setLoadingProcesos] = useState(false);
  const [procesoSeleccionadoId, setProcesoSeleccionadoId] = useState('');

  const [invitacionForm, setInvitacionForm] = useState({
    fecha: '',
    hora: '',
    observaciones: ''
  });
  const [guardandoInvitacion, setGuardandoInvitacion] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Cambia cada vez que se crea una invitación, para forzar que el
  // calendario recargue sus propias citas (ver uso en el `key` más abajo).
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);

  useEffect(() => {
    if (!isAdmin) return;

    (async () => {
      setLoadingMediadores(true);

      try {
        const data = await getUsuarios();
        setMediadores(data.filter((u: any) => u.rol === 'mediador' && u.activo));
      } catch (err) {
        console.error(err);
        setMediadores([]);
      } finally {
        setLoadingMediadores(false);
      }
    })();
  }, [isAdmin]);

  // El mediador cuya agenda se está viendo: el seleccionado (admin) o uno
  // mismo. Es también a quién se le puede agendar una invitación nueva.
  const usuarioIdAgenda = isAdmin
    ? (mediadorSeleccionadoId ? Number(mediadorSeleccionadoId) : null)
    : user?.id ?? null;

  // Separado del useEffect de abajo para poder volver a llamarlo cuando
  // una invitación se cancela desde el propio calendario (ver
  // onCitaActualizada más abajo) — si no, el proceso de esa invitación se
  // queda sin aparecer en el selector hasta salir y volver a entrar a
  // Agenda, porque la lista de procesos solo se cargaba una vez al elegir
  // el mediador.
  const cargarProcesosDisponibles = useCallback(async (usuarioId: number) => {
    setLoadingProcesos(true);

    try {
      const data = await getProcesos({
        usuario_id: usuarioId,
        estado: 'en_negociacion'
      });

      setProcesos(data.filter((p: any) => !p.tiene_invitacion_pendiente));
    } catch (err) {
      console.error(err);
      setProcesos([]);
    } finally {
      setLoadingProcesos(false);
    }
  }, []);

  useEffect(() => {
    setProcesoSeleccionadoId('');
    setInvitacionForm({ fecha: '', hora: '', observaciones: '' });
    setError('');
    setSuccessMessage('');

    if (!usuarioIdAgenda) {
      setProcesos([]);
      return;
    }

    cargarProcesosDisponibles(usuarioIdAgenda);
  }, [usuarioIdAgenda, cargarProcesosDisponibles]);

  const handleCrearInvitacion = async () => {
    if (!procesoSeleccionadoId || !invitacionForm.fecha || !invitacionForm.hora) return;

    if (!invitacionForm.observaciones.trim()) {
      setError('Debes ingresar una observación para la invitación');
      return;
    }

    setGuardandoInvitacion(true);
    setError('');
    setSuccessMessage('');

    const fechaEnviada = invitacionForm.fecha;
    const horaEnviada = invitacionForm.hora;

    try {
      await crearInvitacionProceso(Number(procesoSeleccionadoId), invitacionForm);

      setInvitacionForm({ fecha: '', hora: '', observaciones: '' });
      setCalendarRefreshKey((k) => k + 1);

      // El proceso que se acaba de agendar ya no se puede volver a elegir
      // hasta que esa invitación se resuelva.
      setProcesos((prev) => prev.filter((p) => String(p.id) !== procesoSeleccionadoId));
      setProcesoSeleccionadoId('');

      setSuccessMessage(
        `Invitación creada para el ${fechaEnviada} a las ${horaEnviada}.`
      );
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Error al crear invitación');
    } finally {
      setGuardandoInvitacion(false);
    }
  };

  if (loadingUser || !user) {
    return <Spinner />;
  }

  const mediadorActivo = isAdmin
    ? mediadores.find((m) => String(m.id) === mediadorSeleccionadoId)
    : null;

  // Agrupa a los mediadores por sucursal para que el admin sepa
  // de dónde es cada uno, incluso con muchos mediadores en la lista.
  const gruposPorSucursal = mediadores.reduce((acc: Record<string, any[]>, m) => {
    const clave = m.sucursal || 'Sin sucursal asignada';
    if (!acc[clave]) acc[clave] = [];
    acc[clave].push(m);
    return acc;
  }, {});

  const nombresSucursales = Object.keys(gruposPorSucursal).sort((a, b) =>
    a.localeCompare(b)
  );

  const procesoSeleccionado = procesos.find(
    (p) => String(p.id) === procesoSeleccionadoId
  );

  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle={
          isAdmin
            ? 'Consulta y gestiona el estado de las invitaciones de cualquier mediador'
            : 'Consulta y gestiona el estado de tus invitaciones asignadas'
        }
      />

      {isAdmin && (
        <div className="card p-4 mb-6 max-w-sm">
          <SelectField
            label="Mediador"
            value={mediadorSeleccionadoId}
            onChange={(e) => setMediadorSeleccionadoId(e.target.value)}
          >
            <option value="">Selecciona un mediador</option>

            {nombresSucursales.map((sucursal) => (
              <optgroup
                key={sucursal}
                label={`${sucursal}${
                  gruposPorSucursal[sucursal][0]?.ciudad
                    ? ` — ${gruposPorSucursal[sucursal][0].ciudad}`
                    : ''
                }`}
              >
                {gruposPorSucursal[sucursal]
                  .slice()
                  .sort((a, b) =>
                    `${a.nombre} ${a.apellido}`.localeCompare(`${b.nombre} ${b.apellido}`)
                  )
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} {m.apellido}
                    </option>
                  ))}
              </optgroup>
            ))}
          </SelectField>

          {mediadorActivo && (
            <p className="text-xs text-numa-500 mt-2">
              {mediadorActivo.sucursal}
              {mediadorActivo.ciudad && ` — ${mediadorActivo.ciudad}`}
              {mediadorActivo.provincia && `, ${mediadorActivo.provincia}`}
            </p>
          )}
        </div>
      )}

      <div className="card p-5">
        {isAdmin ? (
          loadingMediadores ? (
            <Spinner />
          ) : !mediadorSeleccionadoId ? (
            <EmptyState message="Selecciona un mediador para ver su agenda." />
          ) : (
            <>
              {/* Agendar una invitación nueva: primero se elige a qué
                  proceso pertenece (no hay forma de saber a quién se
                  refiere un proceso con solo su número), y recién ahí se
                  habilita el calendario para escoger fecha y hora. */}
              <div className="mb-5 pb-5 border-b border-numa-100">
                <h3 className="text-sm font-semibold text-numa-800 mb-3 flex items-center gap-2">
                  <CalendarPlus className="w-4 h-4 text-gold-600" />
                  Agendar nueva invitación
                </h3>

                {loadingProcesos ? (
                  <Spinner />
                ) : procesos.length === 0 ? (
                  <p className="text-xs text-numa-400">
                    {mediadorActivo?.nombre || 'Este mediador'} no tiene procesos en negociación
                    disponibles para agendar (o todos ya tienen una invitación pendiente).
                  </p>
                ) : (
                  <div className="max-w-md">
                    <SelectField
                      label="Proceso"
                      value={procesoSeleccionadoId}
                      onChange={(e) => {
                        setProcesoSeleccionadoId(e.target.value);
                        setInvitacionForm({ fecha: '', hora: '', observaciones: '' });
                        setError('');
                        setSuccessMessage('');
                      }}
                    >
                      <option value="">Selecciona un proceso</option>
                      {procesos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.codigo_proceso} — {p.demandante} vs {p.demandado}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                )}
              </div>

              <CalendarioAgendaMediador
                key={`${mediadorSeleccionadoId}-${calendarRefreshKey}`}
                usuarioId={Number(mediadorSeleccionadoId)}
                mediadorNombre={
                  mediadorActivo ? `${mediadorActivo.nombre} ${mediadorActivo.apellido}` : undefined
                }
                permitirCrear={!!procesoSeleccionadoId}
                onConfirmar={(fecha, hora) => {
                  setInvitacionForm({ ...invitacionForm, fecha, hora });
                  setError('');
                  setSuccessMessage('');
                }}
                onCitaActualizada={() => cargarProcesosDisponibles(Number(mediadorSeleccionadoId))}
              />

              {procesoSeleccionado && invitacionForm.fecha && invitacionForm.hora && (
                <div className="mt-5 border-t border-numa-100 pt-5">
                  <p className="text-sm text-numa-700 mb-3">
                    Agendando para{' '}
                    <span className="font-semibold">
                      {procesoSeleccionado.codigo_proceso} — {procesoSeleccionado.demandante} vs{' '}
                      {procesoSeleccionado.demandado}
                    </span>{' '}
                    el <span className="font-semibold">{invitacionForm.fecha}</span> a las{' '}
                    <span className="font-semibold">{invitacionForm.hora}</span>.
                  </p>

                  <TextareaField
                    label="Observaciones"
                    rows={3}
                    value={invitacionForm.observaciones}
                    onChange={(e) =>
                      setInvitacionForm({
                        ...invitacionForm,
                        observaciones: e.target.value
                      })
                    }
                    placeholder="Ejemplo: Primera invitación a reunión de mediación..."
                  />

                  {error && (
                    <div className="mt-3">
                      <ErrorAlert message={error} />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleCrearInvitacion}
                    disabled={guardandoInvitacion || !invitacionForm.observaciones.trim()}
                    className="btn-primary mt-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {guardandoInvitacion ? 'Guardando...' : 'Crear invitación'}
                  </button>
                </div>
              )}

              {successMessage && !invitacionForm.fecha && (
                <div className="mt-5">
                  <SuccessAlert message={successMessage} />
                </div>
              )}
            </>
          )
        ) : (
          <>
            <div className="mb-5 pb-5 border-b border-numa-100">
              <h3 className="text-sm font-semibold text-numa-800 mb-3 flex items-center gap-2">
                <CalendarPlus className="w-4 h-4 text-gold-600" />
                Agendar nueva invitación
              </h3>

              {loadingProcesos ? (
                <Spinner />
              ) : procesos.length === 0 ? (
                <p className="text-xs text-numa-400">
                  No tienes procesos en negociación disponibles para agendar (o todos ya tienen
                  una invitación pendiente).
                </p>
              ) : (
                <div className="max-w-md">
                  <SelectField
                    label="Proceso"
                    value={procesoSeleccionadoId}
                    onChange={(e) => {
                      setProcesoSeleccionadoId(e.target.value);
                      setInvitacionForm({ fecha: '', hora: '', observaciones: '' });
                      setError('');
                      setSuccessMessage('');
                    }}
                  >
                    <option value="">Selecciona un proceso</option>
                    {procesos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.codigo_proceso} — {p.demandante} vs {p.demandado}
                      </option>
                    ))}
                  </SelectField>
                </div>
              )}
            </div>

            <CalendarioAgendaMediador
              key={calendarRefreshKey}
              usuarioId={user.id}
              mediadorNombre={user.username}
              permitirCrear={!!procesoSeleccionadoId}
              onConfirmar={(fecha, hora) => {
                setInvitacionForm({ ...invitacionForm, fecha, hora });
                setError('');
                setSuccessMessage('');
              }}
              onCitaActualizada={() => user?.id && cargarProcesosDisponibles(user.id)}
            />

            {procesoSeleccionado && invitacionForm.fecha && invitacionForm.hora && (
              <div className="mt-5 border-t border-numa-100 pt-5">
                <p className="text-sm text-numa-700 mb-3">
                  Agendando para{' '}
                  <span className="font-semibold">
                    {procesoSeleccionado.codigo_proceso} — {procesoSeleccionado.demandante} vs{' '}
                    {procesoSeleccionado.demandado}
                  </span>{' '}
                  el <span className="font-semibold">{invitacionForm.fecha}</span> a las{' '}
                  <span className="font-semibold">{invitacionForm.hora}</span>.
                </p>

                <TextareaField
                  label="Observaciones"
                  rows={3}
                  value={invitacionForm.observaciones}
                  onChange={(e) =>
                    setInvitacionForm({
                      ...invitacionForm,
                      observaciones: e.target.value
                    })
                  }
                  placeholder="Ejemplo: Primera invitación a reunión de mediación..."
                />

                {error && (
                  <div className="mt-3">
                    <ErrorAlert message={error} />
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleCrearInvitacion}
                  disabled={guardandoInvitacion || !invitacionForm.observaciones.trim()}
                  className="btn-primary mt-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {guardandoInvitacion ? 'Guardando...' : 'Crear invitación'}
                </button>
              </div>
            )}

            {successMessage && !invitacionForm.fecha && (
              <div className="mt-5">
                <SuccessAlert message={successMessage} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
