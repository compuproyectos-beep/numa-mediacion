'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import 'react-big-calendar/lib/css/react-big-calendar.css';

import { InputField, TextareaField, Spinner, ErrorAlert, Modal } from '@/components/ui';
import { getCitas, cambiarEstadoCita } from '@/lib/services';

const locales = { es };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

const colorPorEstado: Record<string, string> = {
  pendiente: '#E0B84A',
  realizada: '#16A34A',
  cancelada: '#DC2626',
  reagendada: '#4A6789',
};

const NOMBRES_MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// Reemplaza la barra de arriba del calendario (por defecto, tres botones
// "Hoy" / "Atrás" / "Siguiente" uno al lado del otro, del mismo tamaño que
// el nombre del mes) por una más compacta: flechas PEGADAS al mes (no en
// los extremos de toda la barra), el mes y el año como selectores para
// saltar directo sin tener que ir dando clic de uno en uno, y un botón
// pequeño de "Hoy" aparte.
function BarraCalendario({ date, onNavigate }: any) {
  const mesActual: number = date.getMonth();
  const anioActual: number = date.getFullYear();

  // Un rango amplio de años (5 para atrás y 5 para adelante del año en
  // curso) — de sobra tanto para revisar el historial de citas viejas
  // como para agendar con bastante anticipación.
  const anios = useMemo(() => {
    const base = new Date().getFullYear();
    return Array.from({ length: 11 }, (_, i) => base - 5 + i);
  }, []);

  const irA = (mes: number, anio: number) => {
    onNavigate('DATE', new Date(anio, mes, 1));
  };

  const estiloSelector =
    'text-sm font-semibold text-numa-800 capitalize bg-transparent border-none ' +
    'rounded-sm px-1 py-0.5 cursor-pointer hover:bg-gold-400/10 ' +
    'focus:outline-none focus:ring-1 focus:ring-gold-400';

  // Las flechas de "mes anterior / siguiente" van en un círculo oscuro
  // relleno — a propósito bien distintas de la flechita gris chiquita que
  // el navegador ya le dibuja a cada <select> (la de "mes ▾" y "año ▾"),
  // para que no se confundan siendo dos cosas distintas: estas SIEMPRE
  // mueven un mes para adelante o atrás; las de los selectores abren la
  // lista para saltar directo a cualquier mes o año.
  const estiloFlecha =
    'p-1.5 rounded-full bg-numa-800 text-white hover:bg-numa-900 ' +
    'transition-colors shrink-0';

  return (
    <div className="flex items-center justify-center mb-3 gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => onNavigate('PREV')}
        aria-label="Mes anterior"
        className={estiloFlecha}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <select
        value={mesActual}
        onChange={(e) => irA(Number(e.target.value), anioActual)}
        aria-label="Elegir mes"
        className={estiloSelector}
      >
        {NOMBRES_MESES.map((nombre, i) => (
          <option key={nombre} value={i}>
            {nombre}
          </option>
        ))}
      </select>

      <select
        value={anioActual}
        onChange={(e) => irA(mesActual, Number(e.target.value))}
        aria-label="Elegir año"
        className={estiloSelector}
      >
        {anios.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => onNavigate('NEXT')}
        aria-label="Mes siguiente"
        className={estiloFlecha}
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {/* "Hoy" va pegado al mismo grupo centrado, no suelto en la otra
          punta de la barra. */}
      <button
        type="button"
        onClick={() => onNavigate('TODAY')}
        className="text-[11px] font-medium text-gold-600 border border-gold-400/40 rounded-full px-2.5 py-0.5 hover:bg-gold-400/10 transition-colors shrink-0 ml-1"
      >
        Hoy
      </button>
    </div>
  );
}

// OJO: nunca usar toISOString() para sacar solo la fecha — convierte a
// UTC, y Ecuador/Colombia están en UTC-5. En la noche (después de las
// 19:00 aprox.) toISOString() ya devuelve el día siguiente, mientras que
// toTimeString() (usada en horaActual) sigue dando la hora local real.
// Esa mezcla fue la causa de un bug: alguien elegía "mañana" y el sistema
// lo trataba como si fuera "hoy", y entonces una hora que todavía no
// llegaba aparecía como "ya pasó". Por eso la fecha siempre se arma a
// mano con los componentes LOCALES de la fecha.
const fechaISOLocal = (date: Date) => {
  const anio = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const dia = String(date.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
};

const hoyISO = () => fechaISOLocal(new Date());
const horaActual = () => new Date().toTimeString().slice(0, 5);

interface CalendarioAgendaMediadorProps {
  usuarioId: number;
  mediadorNombre?: string;
  onConfirmar?: (fecha: string, hora: string) => void;
  permitirCrear?: boolean;
  permitirGestionarEstado?: boolean;
  // Permite cancelar una invitación pendiente sin habilitar también
  // "Marcar como realizada" — se usa dentro del proceso, donde registrar
  // el resultado ya tiene su propio formulario dedicado (con observación,
  // resultado, etc.), pero cancelar sí conviene poder hacerlo ahí mismo
  // sin tener que salir a la pantalla de Agenda.
  permitirCancelar?: boolean;
  // Se llama después de cancelar o marcar una cita como realizada, para
  // que la pantalla que contiene este calendario (por ejemplo, la del
  // proceso) pueda refrescar su propia información — si no, esa pantalla
  // no se entera del cambio y puede quedar mostrando datos viejos (como
  // seguir ocultando el formulario de "nueva invitación" aunque la
  // pendiente ya se haya cancelado).
  onCitaActualizada?: () => void;
  // Se llama al abrir una cita YA EXISTENTE (para solo verla/gestionarla),
  // no al elegir una fecha/hora nueva. La página que contiene este
  // calendario puede guardar la última fecha/hora confirmada con
  // "Usar esta fecha y hora" (para mostrar el formulario de "Agendando
  // para..."), y ese dato queda viejo/confuso si después el mediador solo
  // abre una cita distinta para verla — este aviso le permite limpiarlo.
  onVerCitaExistente?: () => void;
}

export default function CalendarioAgendaMediador({
  usuarioId,
  mediadorNombre,
  onConfirmar,
  permitirCrear = true,
  permitirGestionarEstado = true,
  permitirCancelar = false,
  onCitaActualizada,
  onVerCitaExistente,
}: CalendarioAgendaMediadorProps) {
  const [citas, setCitas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [calendarDate, setCalendarDate] = useState(new Date());

  // Día vacío elegido para agendar una cita NUEVA
  const [diaSeleccionado, setDiaSeleccionado] = useState('');
  const [horaSeleccionada, setHoraSeleccionada] = useState('09:00');

  // Cita EXISTENTE elegida para ver/gestionar su estado
  const [citaActiva, setCitaActiva] = useState<any | null>(null);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [errorEstado, setErrorEstado] = useState('');
  const [mostrarConfirmarCancelar, setMostrarConfirmarCancelar] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState('');
  const [errorMotivoCancelacion, setErrorMotivoCancelacion] = useState('');

  // El panel con el detalle del día o de una cita aparece debajo del
  // calendario. Cuando se abre desde "+N más" (o seleccionando un día o una
  // cita), este panel puede quedar fuera de la vista sin que se note que
  // hay que bajar para verlo — por eso se desplaza la pantalla sola hasta
  // ahí apenas aparece.
  //
  // Esto se hace a mano (no con un useEffect que mire diaSeleccionado) a
  // propósito: si ya tenías elegido, por ejemplo, el sábado y volvés a
  // tocar "+N más" del sábado otra vez, el valor de diaSeleccionado no
  // cambia (sigue siendo el mismo día), así que un useEffect NO se
  // volvería a disparar y no bajaría la segunda vez. Llamando a esto
  // directamente en cada clic, siempre baja, aunque el día elegido sea el
  // mismo de antes.
  const panelRef = useRef<HTMLDivElement>(null);

  const forzarScrollAlPanel = () => {
    // Doble requestAnimationFrame: espera a que React ya haya pintado el
    // panel (puede no existir todavía en este mismo instante si antes no
    // había ningún día ni cita seleccionada) antes de intentar bajar hasta
    // él.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  };

  // Elige un día para agendar una nueva invitación. Se usa tanto al hacer
  // clic/arrastrar en el espacio en blanco de una casilla (onSelectSlot)
  // como al tocar el número del día (onDrillDown) — en celdas con varias
  // invitaciones casi no queda espacio en blanco donde dar clic, pero el
  // número del día siempre está visible y libre, así que también sirve
  // como botón para elegir esa fecha.
  const seleccionarDiaParaNuevaInvitacion = useCallback(
    (fecha: Date) => {
      if (!permitirCrear) return;

      const fechaISO = fechaISOLocal(new Date(fecha));

      // No se puede agendar una cita nueva en una fecha pasada
      if (fechaISO < hoyISO()) return;

      setCitaActiva(null);
      setErrorEstado('');
      setDiaSeleccionado(fechaISO);
      setHoraSeleccionada(fechaISO === hoyISO() ? '' : '09:00');
      forzarScrollAlPanel();
    },
    [permitirCrear]
  );

  // El espacio en blanco de una casilla usa, por defecto, el mecanismo
  // propio de react-big-calendar para detectar el toque (basado en
  // "mantener presionado sin mover el dedo"). En un celular real casi
  // siempre hay un microtemblor del dedo al tocar, y ese mecanismo lo
  // interpreta como que el usuario está arrastrando para hacer scroll, no
  // seleccionando — por eso el número del día (que es un botón normal)
  // respondía siempre, pero el espacio en blanco fallaba casi siempre en
  // un teléfono de verdad, aunque en una computadora con mouse sí
  // funcionaba. Envolviendo cada casilla del mes en un div con su propio
  // onClick (un clic/toque normal del navegador, sin ese mecanismo
  // especial) se vuelve igual de confiable que tocar el número.
  const CeldaDiaSeleccionable = useCallback(
    ({ value, children }: any) => {
      if (!permitirCrear) return children;

      // "display: flex" en el envoltorio es a propósito: la casilla de
      // adentro (que pinta el fondo, el resaltado del día elegido, etc.)
      // depende de que su propio contenedor directo sea flex para
      // estirarse a toda la altura de la celda (así funcionaba antes,
      // cuando ella misma era la hija directa de la fila). Si el
      // envoltorio no fuera flex, esa casilla se quedaría con alto cero y
      // el color de fondo dejaría de verse.
      return (
        <div
          className="numa-celda-dia-wrapper"
          onClick={() => seleccionarDiaParaNuevaInvitacion(value)}
          style={{ flex: '1 0 0%', display: 'flex', cursor: 'pointer' }}
        >
          {children}
        </div>
      );
    },
    [permitirCrear, seleccionarDiaParaNuevaInvitacion]
  );

  const cargarCitas = useCallback(async () => {
    setLoading(true);

    try {
      const data = await getCitas({ usuario_id: usuarioId });
      setCitas(data);
    } catch (err) {
      console.error(err);
      setCitas([]);
    } finally {
      setLoading(false);
    }
  }, [usuarioId]);

  useEffect(() => {
    cargarCitas();
  }, [cargarCitas]);

  const eventos = useMemo(() => {
    return citas.map((cita) => {
      const inicio = new Date(`${cita.fecha}T${cita.hora}`);
      const fin = new Date(inicio);
      fin.setHours(fin.getHours() + 1);

      const partes = [cita.demandante, cita.demandado].filter(Boolean).join(' vs ');

      return {
        id: cita.id,
        title: `${cita.hora?.slice(0, 5) ?? ''} ${partes || cita.tema || ''}`.trim(),
        start: inicio,
        end: fin,
        resource: cita,
      };
    });
  }, [citas]);

  const tooltipEvento = (event: any) => {
    const c = event.resource;
    const partes = [c.demandante, c.demandado].filter(Boolean).join(' vs ');
    const ubicacion = [c.sucursal, c.ciudad].filter(Boolean).join(' — ');
    return [
      `${c.hora?.slice(0, 5) ?? ''} · ${c.estado === 'pendiente' && event.start < new Date() ? 'atrasada (sin resultado)' : c.estado}`,
      c.tema,
      partes,
      ubicacion,
    ]
      .filter(Boolean)
      .join('\n');
  };

  // Solo las citas pendientes bloquean un horario nuevo — una cita
  // realizada o cancelada ya no ocupa esa hora.
  const horasOcupadasDelDia = diaSeleccionado
    ? citas
        .filter((c) => c.fecha === diaSeleccionado && c.estado === 'pendiente')
        .map((c) => c.hora?.slice(0, 5))
        .filter(Boolean)
    : [];

  const citasDelDia = diaSeleccionado
    ? citas.filter((c) => c.fecha === diaSeleccionado)
    : [];

  const esHoy = diaSeleccionado === hoyISO();
  const horaYaOcupada = horasOcupadasDelDia.includes(horaSeleccionada);
  const horaYaPaso = esHoy && horaSeleccionada < horaActual();

  const etiquetaFecha = (fecha: string) =>
    new Date(`${fecha}T00:00:00`).toLocaleDateString('es-EC', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  const handleCambiarEstado = async (nuevoEstado: string, motivo?: string) => {
    if (!citaActiva) return;

    setCambiandoEstado(true);
    setErrorEstado('');

    try {
      await cambiarEstadoCita(citaActiva.id, nuevoEstado, motivo);
      await cargarCitas();
      setCitaActiva({ ...citaActiva, estado: nuevoEstado, motivo_cancelacion: motivo });
      onCitaActualizada?.();
    } catch (err: any) {
      setErrorEstado(
        err?.response?.data?.detail || 'No se pudo actualizar el estado de la invitación'
      );
    } finally {
      setCambiandoEstado(false);
    }
  };

  const handleCancelarClick = () => {
    if (!citaActiva) return;
    setMotivoCancelacion('');
    setErrorMotivoCancelacion('');
    setMostrarConfirmarCancelar(true);
  };

  const confirmarCancelacion = () => {
    if (!motivoCancelacion.trim()) {
      setErrorMotivoCancelacion('Debes indicar el motivo de la cancelación');
      return;
    }

    setMostrarConfirmarCancelar(false);
    handleCambiarEstado('cancelada', motivoCancelacion.trim());
  };

  return (
    <div>
      {mediadorNombre && (
        <p className="text-sm text-numa-500 mb-3">
          Agenda de <span className="font-semibold text-numa-700">{mediadorNombre}</span>.
          <span className="inline-flex items-center gap-1 ml-2">
            <span className="w-2 h-2 rounded-full bg-gold-400 inline-block" /> Pendiente
          </span>
          <span className="inline-flex items-center gap-1 ml-2">
            <span className="w-2 h-2 rounded-full bg-orange-600 inline-block" /> Atrasada
          </span>
          <span className="inline-flex items-center gap-1 ml-2">
            <span className="w-2 h-2 rounded-full bg-green-600 inline-block" /> Realizada
          </span>
          <span className="inline-flex items-center gap-1 ml-2">
            <span className="w-2 h-2 rounded-full bg-red-600 inline-block" /> Cancelada
          </span>
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <div className="calendario-numa h-[440px]">
          <Calendar
            localizer={localizer}
            date={calendarDate}
            onNavigate={(date) => setCalendarDate(date)}
            selectable={permitirCrear}
            longPressThreshold={1}
            defaultView={Views.MONTH}
            views={[Views.MONTH]}
            startAccessor="start"
            endAccessor="end"
            culture="es"
            events={eventos}
            tooltipAccessor={tooltipEvento}
            popup={false}
            onShowMore={(_eventosDelDia: any[], fecha: Date) => {
              // El popup nativo "+N más" de react-big-calendar se renderiza
              // dentro del propio calendario y puede quedar recortado o tapado
              // según el contenedor donde esté el calendario (por ejemplo,
              // dentro de un modal o una tarjeta con scroll). Para que las
              // citas de ese día SIEMPRE se puedan ver, se reutiliza el mismo
              // panel de "citas del día" que ya se muestra debajo del
              // calendario al seleccionar un día vacío.
              //
              // "+N más" solo debe MOSTRAR las citas de ese día, no debe
              // bloquearse si la fecha ya pasó (a diferencia de elegir un
              // día para agendar), así que esto no reutiliza
              // seleccionarDiaParaNuevaInvitacion.
              const fechaISO = fechaISOLocal(new Date(fecha));
              setCitaActiva(null);
              setErrorEstado('');
              setDiaSeleccionado(fechaISO);
              setHoraSeleccionada(fechaISO === hoyISO() ? '' : '09:00');
              forzarScrollAlPanel();
            }}
            components={{ toolbar: BarraCalendario, dateCellWrapper: CeldaDiaSeleccionable }}
            messages={{
              next: 'Siguiente',
              previous: 'Anterior',
              today: 'Hoy',
              month: 'Mes',
              noEventsInRange: 'Sin invitaciones',
              showMore: (total: number) => `+${total} más`,
            }}
            dayPropGetter={(date: Date) => {
              const esPasado = date < new Date(new Date().toDateString());
              const fechaISO = fechaISOLocal(date);
              // Marca en el propio calendario cuál día quedó elegido (al
              // tocarlo para una nueva invitación, o al abrir una cita
              // existente ese día), para que quede clara la relación con
              // el panel que aparece debajo.
              const esSeleccionado =
                fechaISO === diaSeleccionado || fechaISO === citaActiva?.fecha;

              if (esSeleccionado) {
                return {
                  style: {
                    backgroundColor: 'rgba(224, 184, 74, 0.14)',
                    boxShadow: 'inset 0 0 0 2px #E0B84A',
                  },
                };
              }

              return esPasado
                ? { style: { backgroundColor: '#F8FAFC', color: '#B9C4D3' } }
                : {};
            }}
            eventPropGetter={(event: any) => ({
              style: {
                // Pendiente que ya pasó de fecha = atrasada: naranja fuerte,
                // para distinguirla de las pendientes que aún están por venir.
                backgroundColor:
                  event.resource.estado === 'pendiente' && event.start < new Date()
                    ? '#EA580C'
                    : colorPorEstado[event.resource.estado] || '#4A6789',
                color:
                  event.resource.estado === 'pendiente' && event.start >= new Date()
                    ? '#0E2338'
                    : '#fff',
                border: 'none',
                fontSize: '11px',
                fontWeight: 600,
              },
            })}
            onSelectSlot={(slotInfo: any) => seleccionarDiaParaNuevaInvitacion(slotInfo.start)}
            onDrillDown={(fecha: Date) => seleccionarDiaParaNuevaInvitacion(fecha)}
            onSelectEvent={(event: any) => {
              setDiaSeleccionado('');
              setErrorEstado('');
              setCitaActiva(event.resource);
              onVerCitaExistente?.();
              forzarScrollAlPanel();
            }}
          />

          {permitirCrear && (
            <style jsx global>{`
              /* El número del día (arriba de cada casilla) también elige
                 esa fecha para una nueva invitación (ver onDrillDown más
                 arriba). Se agranda su área de toque y se marca con el
                 cursor de "esto se puede tocar", porque en un día con
                 varias invitaciones casi no queda espacio en blanco donde
                 dar clic, y el número siempre está libre. */
              .calendario-numa .rbc-button-link {
                cursor: pointer;
                padding: 4px 6px;
                margin: -4px -6px;
                border-radius: 4px;
              }

              .calendario-numa .rbc-day-bg:not(.rbc-off-range-bg):hover {
                background-color: rgba(224, 184, 74, 0.08);
              }

              /* La línea delgada que separa una columna de día de la
                 siguiente normalmente la dibuja react-big-calendar entre
                 casillas que son hermanas directas. Como ahora cada
                 casilla va envuelta en un div propio (para que todo el
                 espacio en blanco responda al toque, no solo el número),
                 esas casillas ya no son hermanas directas — así que la
                 línea se vuelve a dibujar aquí, entre los envoltorios. */
              .calendario-numa .numa-celda-dia-wrapper + .numa-celda-dia-wrapper {
                border-left: 1px solid #ddd;
              }
            `}</style>
          )}
        </div>
      )}

      {/* Detalle y gestión de una cita existente */}
      {citaActiva && (
        <div ref={panelRef} className="mt-5 border-t border-numa-100 pt-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-numa-800 capitalize">
                {etiquetaFecha(citaActiva.fecha)} — {citaActiva.hora?.slice(0, 5)}
              </p>
              <p className="text-xs text-numa-500 mt-0.5">
                Estado:{' '}
                <span className="font-semibold capitalize">{citaActiva.estado}</span>
              </p>
            </div>

            <span
              className={
                citaActiva.estado === 'pendiente'
                  ? 'badge bg-gold-400/10 text-gold-600'
                  : citaActiva.estado === 'realizada'
                  ? 'badge bg-green-50 text-green-700'
                  : citaActiva.estado === 'cancelada'
                  ? 'badge bg-red-50 text-red-700'
                  : 'badge bg-numa-100 text-numa-700'
              }
            >
              {citaActiva.estado}
            </span>
          </div>

          <div className="bg-numa-50 border border-numa-100 rounded-sm p-4 mb-4 space-y-2 text-sm">
            {citaActiva.tema && (
              <p>
                <span className="text-numa-500">Tema:</span>{' '}
                <span className="text-numa-800 font-medium">{citaActiva.tema}</span>
              </p>
            )}

            {(citaActiva.demandante || citaActiva.demandado) && (
              <p>
                <span className="text-numa-500">Partes:</span>{' '}
                <span className="text-numa-800 font-medium">
                  {citaActiva.demandante}
                  {citaActiva.demandante_cedula && ` (${citaActiva.demandante_cedula})`}
                  {' vs '}
                  {citaActiva.demandado}
                  {citaActiva.demandado_cedula && ` (${citaActiva.demandado_cedula})`}
                </span>
              </p>
            )}

            {citaActiva.sucursal && (
              <p>
                <span className="text-numa-500">Sucursal:</span>{' '}
                <span className="text-numa-800 font-medium">
                  {citaActiva.sucursal}
                  {citaActiva.ciudad && ` — ${citaActiva.ciudad}`}
                  {citaActiva.provincia && `, ${citaActiva.provincia}`}
                </span>
              </p>
            )}

            {citaActiva.codigo_acta && (
              <p>
                <span className="text-numa-500">Acta vinculada:</span>{' '}
                <span className="text-numa-800 font-medium">{citaActiva.codigo_acta}</span>
              </p>
            )}

            {citaActiva.observaciones && (
              <p>
                <span className="text-numa-500">Observaciones:</span>{' '}
                <span className="text-numa-800">{citaActiva.observaciones}</span>
              </p>
            )}

            {citaActiva.estado === 'cancelada' && citaActiva.motivo_cancelacion && (
              <p>
                <span className="text-numa-500">Motivo de cancelación:</span>{' '}
                <span className="text-numa-800">{citaActiva.motivo_cancelacion}</span>
              </p>
            )}
          </div>

          {errorEstado && (
            <div className="mb-3">
              <ErrorAlert message={errorEstado} />
            </div>
          )}

          {citaActiva.estado === 'pendiente' &&
          (permitirGestionarEstado || permitirCancelar) ? (
            <div className="flex flex-wrap gap-3">
              {permitirGestionarEstado && (
                <button
                  type="button"
                  disabled={cambiandoEstado}
                  onClick={() => handleCambiarEstado('realizada')}
                  className="btn-primary disabled:opacity-50"
                >
                  Marcar como realizada
                </button>
              )}

              <button
                type="button"
                disabled={cambiandoEstado}
                onClick={handleCancelarClick}
                className="btn-secondary text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Cancelar invitación
              </button>
            </div>
          ) : citaActiva.estado === 'pendiente' ? (
            <p className="text-xs text-numa-400">Esta invitación está pendiente.</p>
          ) : (
            <p className="text-xs text-numa-400">
              Esta invitación ya no está pendiente, por lo que no ocupa esa hora para una nueva invitación.
            </p>
          )}
        </div>
      )}

      {/* Citas del día seleccionado (clic en un día vacío o en "+N más") */}
      {diaSeleccionado && !citaActiva && (
        <div ref={panelRef} className="mt-5 border-t border-numa-100 pt-5">
          <p className="text-sm font-semibold text-numa-800 mb-2 capitalize">
            {etiquetaFecha(diaSeleccionado)}
          </p>

          {citasDelDia.length > 0 ? (
            <div className="flex flex-wrap gap-2 mb-4">
              {citasDelDia.map((c) => {
                const partes = [c.demandante, c.demandado].filter(Boolean).join(' vs ');
                return (
                  <button
                    key={c.id}
                    type="button"
                    title={tooltipEvento({ resource: c })}
                    onClick={() => {
                      setDiaSeleccionado('');
                      setCitaActiva(c);
                      onVerCitaExistente?.();
                    }}
                    className={
                      c.estado === 'pendiente'
                        ? 'badge bg-gold-400/10 text-gold-600 hover:bg-gold-400/20'
                        : c.estado === 'realizada'
                        ? 'badge bg-green-50 text-green-700 hover:bg-green-100'
                        : c.estado === 'cancelada'
                        ? 'badge bg-red-50 text-red-700 hover:bg-red-100'
                        : 'badge bg-numa-100 text-numa-700 hover:bg-numa-200'
                    }
                  >
                    {c.hora?.slice(0, 5)} · {c.estado}
                    {partes && ` · ${partes}`}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-numa-400 mb-4">
              Este día no tiene invitaciones registradas para este mediador.
            </p>
          )}

          {/* Elegir fecha/hora para una cita NUEVA — solo si se permite crear */}
          {permitirCrear && (
            <div className="flex flex-wrap items-end gap-4">
              <InputField
                label="Hora para la nueva invitación"
                type="time"
                value={horaSeleccionada}
                min={esHoy ? horaActual() : undefined}
                onChange={(e) => setHoraSeleccionada(e.target.value)}
                error={
                  horaYaOcupada
                    ? 'Esa hora ya está ocupada ese día'
                    : horaYaPaso
                    ? 'Esa hora ya pasó, elige una hora más adelante'
                    : undefined
                }
              />

              <button
                type="button"
                disabled={!horaSeleccionada || horaYaOcupada || horaYaPaso}
                onClick={() => onConfirmar?.(diaSeleccionado, horaSeleccionada)}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Usar esta fecha y hora
              </button>
            </div>
          )}
        </div>
      )}

      <Modal
        open={mostrarConfirmarCancelar}
        onClose={() => setMostrarConfirmarCancelar(false)}
        title="Cancelar invitación"
        size="sm"
      >
        <p className="text-sm text-numa-700 mb-4">
          {citaActiva
            ? `¿Seguro que quieres cancelar la invitación del ${etiquetaFecha(
                citaActiva.fecha
              )} a las ${citaActiva.hora?.slice(0, 5)}? Esta acción no se puede deshacer.`
            : ''}
        </p>

        <TextareaField
          label="Motivo de la cancelación"
          rows={3}
          value={motivoCancelacion}
          onChange={(e) => {
            setMotivoCancelacion(e.target.value);
            if (errorMotivoCancelacion) setErrorMotivoCancelacion('');
          }}
          placeholder="Ejemplo: El mediador se enfermó, se reagendará más adelante..."
        />

        {errorMotivoCancelacion && (
          <p className="text-xs text-red-500 mt-1">{errorMotivoCancelacion}</p>
        )}

        <div className="flex gap-3 justify-end mt-6">
          <button
            onClick={() => setMostrarConfirmarCancelar(false)}
            className="btn-secondary text-sm"
          >
            Volver
          </button>

          <button
            onClick={confirmarCancelacion}
            disabled={cambiandoEstado}
            className="btn-danger text-sm"
          >
            {cambiandoEstado ? 'Procesando...' : 'Sí, cancelar invitación'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
