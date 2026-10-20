'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus, FileText, Users } from 'lucide-react';
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
import InvitacionRapidaForm from '@/components/citas/InvitacionRapidaForm';
import PedirNumeroActaBoton from '@/components/actas/PedirNumeroActaBoton';
import ReunionModal from '@/components/citas/ReunionModal';
import {
  getUsuarios,
  getMediadoresSucursal,
  getProcesos,
  crearInvitacionProceso
} from '@/lib/services';
import { useAuth } from '@/hooks/useAuth';

export default function AgendaPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: loadingUser } = useAuth();
  // La secretaria agenda para los mediadores de su sucursal (llama a uno,
  // ve cuál está libre y le abre la invitación); no ve procesos.
  const esSecretaria = user?.rol === 'secretaria';
  const puedeElegirMediador = isAdmin || esSecretaria;

  const [mediadores, setMediadores] = useState<any[]>([]);
  const [loadingMediadores, setLoadingMediadores] = useState(isAdmin);
  const [reunionNueva, setReunionNueva] = useState(false);
  const [avisoReunionNueva, setAvisoReunionNueva] = useState<any[] | null>(null);
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
  // Última invitación rápida creada (para ofrecer abrir su documento).
  const [rapidaCreada, setRapidaCreada] = useState<any | null>(null);

  // Cambia cada vez que se crea una invitación, para forzar que el
  // calendario recargue sus propias citas (ver uso en el `key` más abajo).
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);

  // Al elegir fecha y hora en el calendario (botón "Usar esta fecha y
  // hora"), el formulario de Observaciones aparece más abajo en la
  // página, fuera del calendario — y se quedaba ahí sin que se notara que
  // había que bajar a escribir la observación. Igual que con el "+N más"
  // del calendario, se baja la pantalla sola hasta ese formulario.
  const observacionesRef = useRef<HTMLDivElement>(null);

  const bajarAObservaciones = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Se baja hasta el panel del día (fecha, hora y botón "Usar esta fecha
        // y hora") para que desde ahí se vea también el formulario de abajo.
        const destino =
          document.getElementById('panel-dia-agenda') ?? observacionesRef.current;
        destino?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  };

  useEffect(() => {
    if (!puedeElegirMediador) return;

    (async () => {
      setLoadingMediadores(true);

      try {
        if (esSecretaria) {
          setMediadores(await getMediadoresSucursal());
          return;
        }

        const data = await getUsuarios();
        // El administrador también puede mediar sus propios procesos (no
        // solo crearlos), así que si tiene sucursal asignada debe poder
        // elegirse aquí igual que cualquier mediador — antes solo entraban
        // los usuarios con rol "mediador" y el admin nunca aparecía.
        setMediadores(
          data.filter(
            (u: any) => (u.rol === 'mediador' || u.rol === 'administrador') && u.activo
          )
        );
      } catch (err) {
        console.error(err);
        setMediadores([]);
      } finally {
        setLoadingMediadores(false);
      }
    })();
  }, [isAdmin, esSecretaria, puedeElegirMediador]);

  // El mediador cuya agenda se está viendo: el seleccionado (admin) o uno
  // mismo. Es también a quién se le puede agendar una invitación nueva.
  const usuarioIdAgenda = puedeElegirMediador
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
    setRapidaCreada(null);

    if (!usuarioIdAgenda || esSecretaria) {
      setProcesos([]);
      return;
    }

    cargarProcesosDisponibles(usuarioIdAgenda);
  }, [usuarioIdAgenda, cargarProcesosDisponibles, esSecretaria]);

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

  const mediadorActivo = puedeElegirMediador
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

  const hayFechaHora = !!(invitacionForm.fecha && invitacionForm.hora);
  const nombreMediadorAgenda = puedeElegirMediador
    ? mediadorActivo
      ? `${mediadorActivo.nombre} ${mediadorActivo.apellido}`
      : undefined
    : `${user.nombre || ''} ${user.apellido || ''}`.trim() || user.username;

  // Todo lo de debajo del selector de mediador es igual para el mediador
  // y para el admin: lo único que cambia es de quién es la agenda.
  const contenidoAgenda = usuarioIdAgenda ? (
    <>
      {/* Agendar: con un proceso ya creado (como siempre) o, sin elegir
          proceso, haciendo clic en una hora libre del calendario para crear
          una invitación rápida (el proceso se crea después). */}
      <div className="mb-5 pb-5 border-b border-numa-100">
        <h3 className="text-sm font-semibold text-numa-800 mb-1 flex items-center gap-2">
          <CalendarPlus className="w-4 h-4 text-gold-600" />
          Agendar nueva invitación
        </h3>
        <p className="text-xs text-numa-500 mb-3">
          {esSecretaria
            ? 'Haz clic en un día del calendario, elige la hora libre y llena los datos: la invitación queda asignada al mediador que seleccionaste arriba y él recibe un aviso.'
            : 'Haz clic en un día del calendario para crear una invitación rápida (sin proceso), o elige primero un proceso ya creado.'}
        </p>

        {esSecretaria ? null : loadingProcesos ? (
          <Spinner />
        ) : procesos.length === 0 ? (
          <p className="text-xs text-numa-400">
            {puedeElegirMediador
              ? `${mediadorActivo?.nombre || 'Este mediador'} no tiene`
              : 'No tienes'}{' '}
            procesos en negociación disponibles para agendar (o todos ya tienen una invitación
            pendiente).
          </p>
        ) : (
          <div className="max-w-md">
            <SelectField
              label="Proceso (opcional)"
              value={procesoSeleccionadoId}
              onChange={(e) => {
                setProcesoSeleccionadoId(e.target.value);
                setInvitacionForm({ fecha: '', hora: '', observaciones: '' });
                setError('');
                setSuccessMessage('');
                setRapidaCreada(null);
              }}
            >
              <option value="">Sin proceso (invitación rápida)</option>
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
        key={`${usuarioIdAgenda}-${calendarRefreshKey}`}
        usuarioId={usuarioIdAgenda}
        mediadorNombre={nombreMediadorAgenda}
        permitirCrear
        onConfirmar={(fecha, hora) => {
          setInvitacionForm({ ...invitacionForm, fecha, hora });
          setError('');
          setSuccessMessage('');
          setRapidaCreada(null);
          bajarAObservaciones();
        }}
        onCitaActualizada={() => {
          if (!esSecretaria) cargarProcesosDisponibles(usuarioIdAgenda);
        }}
        permitirGestionarEstado={!esSecretaria}
        permitirCancelar={esSecretaria}
        sucursalId={isAdmin ? mediadorActivo?.sucursal_id : undefined}
        ignorarReuniones={
          mediadorActivo
            ? mediadorActivo.rol === 'administrador'
            : user?.rol === 'administrador'
        }
        onVerCitaExistente={() => setInvitacionForm({ ...invitacionForm, fecha: '', hora: '' })}
      />

      {/* Con proceso elegido: observaciones y crear, igual que antes. */}
      {procesoSeleccionado && hayFechaHora && (
        <div ref={observacionesRef} className="mt-5 border-t border-numa-100 pt-5 scroll-mt-24">
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

      {/* Sin proceso elegido: invitación rápida. */}
      {!procesoSeleccionado && hayFechaHora && (
        <div ref={observacionesRef} className="scroll-mt-24">
          <InvitacionRapidaForm
            fecha={invitacionForm.fecha}
            hora={invitacionForm.hora}
            usuarioId={usuarioIdAgenda}
            temaObligatorio={!esSecretaria}
            onCancelar={() => setInvitacionForm({ fecha: '', hora: '', observaciones: '' })}
            onCreada={(cita) => {
              setRapidaCreada(cita);
              setInvitacionForm({ fecha: '', hora: '', observaciones: '' });
              setCalendarRefreshKey((k) => k + 1);
            }}
          />
        </div>
      )}

      {rapidaCreada && !hayFechaHora && (
        <div className="mt-5 border border-green-200 bg-green-50 rounded-sm p-4">
          <p className="text-sm text-green-800 font-medium mb-3">
            Invitación rápida creada para el {String(rapidaCreada.fecha).slice(0, 10)} a las{' '}
            {String(rapidaCreada.hora).slice(0, 5)}.
          </p>
          <div className="flex flex-wrap items-start gap-3">
            <button
              type="button"
              onClick={() =>
                router.push(`/procesos/rapida/invitacion-imprimir?cita=${rapidaCreada.id}`)
              }
              className="btn-primary inline-flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              Abrir documento de la invitación
            </button>
            {rapidaCreada.usuario_id === user.id && <PedirNumeroActaBoton />}
          </div>
        </div>
      )}

      {successMessage && !hayFechaHora && (
        <div className="mt-5">
          <SuccessAlert message={successMessage} />
        </div>
      )}
    </>
  ) : null;

  return (
    <>
      <PageHeader
        title="Agenda"
        subtitle={
          isAdmin
            ? 'Consulta y gestiona el estado de las invitaciones de cualquier mediador'
            : esSecretaria
            ? 'Agenda las invitaciones de quienes llegan a la oficina y asígnalas a un mediador'
            : 'Consulta y gestiona el estado de tus invitaciones asignadas'
        }
      />

      {isAdmin && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => {
              setAvisoReunionNueva(null);
              setReunionNueva(true);
            }}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Users className="w-4 h-4" />
            Nueva reunión de mediadores
          </button>

          {avisoReunionNueva && (
            <div
              className={`mt-3 max-w-2xl rounded-sm p-3 text-sm border ${
                avisoReunionNueva.length > 0
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-green-200 bg-green-50 text-green-800'
              }`}
            >
              {avisoReunionNueva.length > 0 ? (
                <>
                  <p className="font-semibold mb-1">
                    Reunión creada y avisada a los mediadores. Atención: estos mediadores ya tienen
                    una invitación pendiente en ese horario (no se cancelaron):
                  </p>
                  <ul className="list-disc ml-5">
                    {avisoReunionNueva.map((a: any) => (
                      <li key={a.id}>
                        {a.mediador} — {String(a.hora).slice(0, 5)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>Reunión creada. Todos los mediadores de tu sucursal recibieron la notificación.</p>
              )}
            </div>
          )}
        </div>
      )}

      <ReunionModal
        open={reunionNueva}
        onClose={() => setReunionNueva(false)}
        onGuardada={(res) => {
          setReunionNueva(false);
          setAvisoReunionNueva(res.conflictos || []);
          setCalendarRefreshKey((k) => k + 1);
        }}
      />

      {puedeElegirMediador && (
        <div className="card p-4 mb-6 max-w-sm">
          <SelectField
            label="Mediador"
            value={mediadorSeleccionadoId}
            onChange={(e) => setMediadorSeleccionadoId(e.target.value)}
          >
            <option value="">Selecciona un mediador</option>

            {esSecretaria &&
              mediadores.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre} {m.apellido}
                  {m.rol === 'administrador' ? ' (administrador)' : ''}
                </option>
              ))}

            {!esSecretaria && nombresSucursales.map((sucursal) => (
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
        {puedeElegirMediador ? (
          loadingMediadores ? (
            <Spinner />
          ) : !mediadorSeleccionadoId ? (
            <EmptyState message="Selecciona un mediador para ver su agenda." />
          ) : (
            contenidoAgenda
          )
        ) : (
          contenidoAgenda
        )}
      </div>
    </>
  );
}
