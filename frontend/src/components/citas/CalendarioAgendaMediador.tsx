'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, FileText, FolderPlus, Users } from 'lucide-react';
import 'react-big-calendar/lib/css/react-big-calendar.css';

import { InputField, TextareaField, Spinner, ErrorAlert, Modal } from '@/components/ui';
import { getCitas, cambiarEstadoCita, getReuniones, cancelarReunion } from '@/lib/services';
import ReunionModal from '@/components/citas/ReunionModal';
import { useAuth } from '@/hooks/useAuth';
import PedirNumeroActaBoton from '@/components/actas/PedirNumeroActaBoton';
import HistorialInvitaciones from '@/components/citas/HistorialInvitaciones';

// Las fechas vienen del servidor en UTC: se muestran en hora de Ecuador.
const fechaCreacionEC = (v: any) => {
  if (!v) return '';
  const iso = String(v).replace(' ', 'T');
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('es-EC', {
    timeZone: 'America/Guayaquil',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Partes de una invitación rápida, una línea por lado, con cédulas.
const textoLadoRapido = (lista: any[] | undefined) =>
  (lista || [])
    .map((x: any) =>
      x.tipo === 'empresa'
        ? `${x.razon_social}${x.ruc ? ` (RUC ${x.ruc})` : ''} — representante legal: ${x.representante_nombre} (C.I. ${x.representante_cedula})`
        : `${x.nombre} (C.I. ${x.cedula})`
    )
    .join('; ');

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
  no_realizada: '#78716C',
  cancelada: '#DC2626',
  reagendada: '#4A6789',
  reunion: '#7C3AED',
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

  // Mes y año en grande, como el título de la agenda, y a la derecha los
  // controles: "Hoy" y las dos flechas pegadas en un solo bloque.
  const estiloSelector =
    'text-lg font-bold text-[#0A2A62] capitalize bg-white border border-[#CBD6E8] ' +
    'rounded-lg px-3 py-1.5 cursor-pointer shadow-sm transition-colors ' +
    'hover:bg-[#F4F7FC] hover:border-[#144193] ' +
    'focus:outline-none focus:ring-2 focus:ring-[#144193]/30 focus:border-[#144193]';

  const estiloBotonNav =
    'px-3 py-2 text-[#144193] hover:bg-[#F4F7FC] transition-colors';

  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
      <div className="flex items-center gap-2">
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
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onNavigate('TODAY')}
          className="text-xs font-medium text-gold-600 border border-gold-400/50 rounded-sm px-3 py-1.5 hover:bg-gold-400/10 transition-colors"
        >
          Hoy
        </button>

        <div className="inline-flex rounded-lg border border-[#CBD6E8] overflow-hidden divide-x divide-[#CBD6E8] bg-white shadow-sm">
          <button
            type="button"
            onClick={() => onNavigate('PREV')}
            aria-label="Mes anterior"
            className={estiloBotonNav}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('NEXT')}
            aria-label="Mes siguiente"
            className={estiloBotonNav}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
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
  // Sucursal de la que se muestran las reuniones de mediadores (solo la usa
  // el administrador: cada quien ve las de su propia sucursal).
  sucursalId?: number;
  // No bloquear las horas con reunión (cuando la agenda es la del
  // administrador, que no se bloquea por las reuniones).
  ignorarReuniones?: boolean;
  // Abre directamente esta invitación al cargar el calendario (llegada desde
  // el Panel General o desde una notificación).
  citaInicialId?: number;
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
  sucursalId,
  ignorarReuniones = false,
  citaInicialId,
}: CalendarioAgendaMediadorProps) {
  const router = useRouter();
  const { user: usuarioActual } = useAuth();
  const [citas, setCitas] = useState<any[]>([]);
  const [reuniones, setReuniones] = useState<any[]>([]);
  const [reunionActiva, setReunionActiva] = useState<any | null>(null);
  const [editandoReunion, setEditandoReunion] = useState(false);
  const [cancelandoReunion, setCancelandoReunion] = useState(false);
  const [motivoReunion, setMotivoReunion] = useState('');
  const [errorReunion, setErrorReunion] = useState('');
  const [avisoReunion, setAvisoReunion] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const esAdminActual = usuarioActual?.rol === 'administrador';
  const esSecretariaActual = usuarioActual?.rol === 'secretaria';
  // La secretaria solo cancela lo que ella agendó y mientras el mediador no haya
  // continuado (sin proceso y sin número de acta pedido).
  const secretariaPuedeCancelar = (c: any) =>
    !!c &&
    c.creado_por_id === usuarioActual?.id &&
    !c.proceso_id &&
    c.estado === 'pendiente' &&
    (!c.numero_acta_codigo || c.numero_acta_estado === 'anulado');
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
  const [mostrarCerrarSinProceso, setMostrarCerrarSinProceso] = useState(false);
  const [notaCierre, setNotaCierre] = useState('');
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
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      setReunionActiva(null);
      setErrorEstado('');
      setDiaSeleccionado(fechaISO);
      setHoraSeleccionada(fechaISO === hoyISO() ? '' : '09:00');
      forzarScrollAlPanel();
    },
    [permitirCrear]
  );

  // En la vista de mes, por encima de las casillas hay una capa transparente
  // (la de las invitaciones) que recibe los clics del espacio en blanco, así
  // que la casilla de abajo nunca se entera. Aquí se detecta ese clic en la
  // capa, se averigua en qué columna cayó y se toma el número de día de esa
  // columna (el mes sale de si la casilla es del mes anterior o siguiente).
  const alHacerClicEnEspacioVacio = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!permitirCrear) return;
    const t = e.target as HTMLElement;
    if (t.closest('.rbc-event, .rbc-button-link, .rbc-show-more, .rbc-header, .numa-celda-dia-wrapper')) return;

    const fila = t.closest('.rbc-month-row');
    if (!fila) return;

    const celdas = Array.from(fila.querySelectorAll('.rbc-day-bg'));
    const col = celdas.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX < r.right;
    });
    if (col < 0) return;

    const celdaNumero = fila.querySelectorAll('.rbc-date-cell')[col] as HTMLElement | undefined;
    const dia = parseInt(celdaNumero?.textContent || '', 10);
    if (!celdaNumero || isNaN(dia)) return;

    let mes = calendarDate.getMonth();
    if (celdaNumero.classList.contains('rbc-off-range')) {
      mes += dia > 15 ? -1 : 1;
    }
    seleccionarDiaParaNuevaInvitacion(new Date(calendarDate.getFullYear(), mes, dia));
  };

  const cargarCitas = useCallback(async () => {
    setLoading(true);

    try {
      const [data, reu] = await Promise.all([
        getCitas({ usuario_id: usuarioId }),
        getReuniones(sucursalId ? { sucursal_id: sucursalId } : undefined).catch(() => []),
      ]);
      setCitas(data);
      setReuniones(reu);
    } catch (err) {
      console.error(err);
      setCitas([]);
      setReuniones([]);
    } finally {
      setLoading(false);
    }
  }, [usuarioId, sucursalId]);

  useEffect(() => {
    cargarCitas();
  }, [cargarCitas]);

  // Si la lista se recarga (p. ej. tras pedir el número de acta), el detalle
  // abierto se actualiza con los datos nuevos en vez de quedarse con los viejos.
  useEffect(() => {
    setCitaActiva((prev: any) => {
      if (!prev) return prev;
      const fresca = citas.find((x) => Number(x.id) === Number(prev.id));
      return fresca ? { ...prev, ...fresca } : prev;
    });
  }, [citas]);

  // Si se llegó con una invitación indicada, se abre sola en cuanto cargan las
  // citas (una sola vez): se muestra el mes de esa invitación y se baja hasta su
  // detalle, sin tener que volver a darle clic.
  const citaInicialAplicada = useRef(false);
  useEffect(() => {
    if (!citaInicialId || citaInicialAplicada.current || loading) return;
    const c = citas.find((x) => Number(x.id) === Number(citaInicialId));
    if (!c) return;
    citaInicialAplicada.current = true;
    setCalendarDate(new Date(`${String(c.fecha).slice(0, 10)}T12:00:00`));
    setDiaSeleccionado('');
    setReunionActiva(null);
    setCitaActiva(c);
    forzarScrollAlPanel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citas, loading, citaInicialId]);

  const horaCorta = (h: any) => String(h ?? '').slice(0, 5);

  const eventos = useMemo(() => {
    const deReuniones = reuniones.map((r) => {
      const inicio = new Date(`${String(r.fecha).slice(0, 10)}T${horaCorta(r.hora_inicio)}`);
      const fin = new Date(`${String(r.fecha).slice(0, 10)}T${horaCorta(r.hora_fin)}`);
      return {
        id: `reunion-${r.id}`,
        title: `${horaCorta(r.hora_inicio)}-${horaCorta(r.hora_fin)} ${r.titulo}`,
        start: inicio,
        end: fin,
        resource: { ...r, esReunion: true, estado: 'reunion' },
      };
    });

    const deCitas = citas.map((cita) => {
      const inicio = new Date(`${cita.fecha}T${cita.hora}`);
      const fin = new Date(inicio);
      fin.setHours(fin.getHours() + 1);

      const partes = [cita.demandante, cita.demandado].filter(Boolean).join(' y ');

      return {
        id: cita.id,
        title: `${cita.falta_tema ? '⚠ ' : ''}${!cita.proceso_id && cita.partes_rapidas ? '⚡ ' : ''}${cita.hora?.slice(0, 5) ?? ''} ${partes || cita.tema || ''}`.trim(),
        start: inicio,
        end: fin,
        resource: cita,
      };
    });

    return [...deReuniones, ...deCitas];
  }, [citas, reuniones]);

  const tooltipEvento = (event: any) => {
    const c = event.resource;
    if (c.esReunion) {
      return [
        `${horaCorta(c.hora_inicio)} a ${horaCorta(c.hora_fin)} · Reunión de mediadores`,
        c.titulo,
        c.detalle,
      ]
        .filter(Boolean)
        .join('\n');
    }
    const partes = [c.demandante, c.demandado].filter(Boolean).join(' y ');
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

  const reunionesDelDia = diaSeleccionado
    ? reuniones.filter((r) => String(r.fecha).slice(0, 10) === diaSeleccionado)
    : [];

  // Una hora dentro de una reunión de mediadores no admite invitaciones.
  const reunionEnLaHora = ignorarReuniones
    ? undefined
    : reunionesDelDia.find(
        (r) =>
          horaSeleccionada >= horaCorta(r.hora_inicio) &&
          horaSeleccionada < horaCorta(r.hora_fin)
      );

  const esHoy = diaSeleccionado === hoyISO();
  const horaYaOcupada =
    horasOcupadasDelDia.includes(horaSeleccionada) || !!reunionEnLaHora;
  const horaYaPaso = esHoy && horaSeleccionada < horaActual();

  const etiquetaFecha = (fecha: string) => {
    const t = new Date(`${fecha}T00:00:00`).toLocaleDateString('es-EC', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  const handleCambiarEstado = async (nuevoEstado: string, motivo?: string) => {
    if (!citaActiva) return;

    setCambiandoEstado(true);
    setErrorEstado('');

    try {
      await cambiarEstadoCita(citaActiva.id, nuevoEstado, motivo);
      await cargarCitas();
      const nota = nuevoEstado === 'realizada' ? (motivo || '').trim() : '';
      setCitaActiva({
        ...citaActiva,
        estado: nuevoEstado,
        motivo_cancelacion: nuevoEstado === 'cancelada' ? motivo : citaActiva.motivo_cancelacion,
        observaciones: nota
          ? [citaActiva.observaciones, `Cierre sin proceso: ${nota}`].filter(Boolean).join('\n')
          : citaActiva.observaciones,
      });
      onCitaActualizada?.();
    } catch (err: any) {
      setErrorEstado(
        err?.response?.data?.detail || 'No se pudo actualizar el estado de la invitación'
      );
    } finally {
      setCambiandoEstado(false);
    }
  };

  const confirmarCierreSinProceso = async () => {
    await handleCambiarEstado('realizada', notaCierre.trim() || undefined);
    setMostrarCerrarSinProceso(false);
    setNotaCierre('');
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
      <div className="mb-4">
        {mediadorNombre && (
          <h3 className="text-base font-semibold text-numa-800">
            Agenda de {mediadorNombre}
          </h3>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-numa-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-gold-400 inline-block" /> Pendiente
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-600 inline-block" /> Atrasada
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-green-600 inline-block" /> Realizada
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-stone-500 inline-block" /> No asistió
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" /> Cancelada
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-600 inline-block" /> Reunión de mediadores
          </span>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="calendario-numa h-[440px]" onClick={alHacerClicEnEspacioVacio}>
          <Calendar
            localizer={localizer}
            date={calendarDate}
            onNavigate={(date) => setCalendarDate(date)}
            selectable={false}
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
              setReunionActiva(null);
              setErrorEstado('');
              setDiaSeleccionado(fechaISO);
              setHoraSeleccionada(fechaISO === hoyISO() ? '' : '09:00');
              forzarScrollAlPanel();
            }}
            components={{ toolbar: BarraCalendario }}
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
                fechaISO === diaSeleccionado ||
                fechaISO === citaActiva?.fecha ||
                fechaISO === String(reunionActiva?.fecha ?? '').slice(0, 10);

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
                    ? '#144193'
                    : '#fff',
                border: 'none',
                fontSize: '11px',
                fontWeight: 600,
              },
            })}
            onDrillDown={(fecha: Date) => seleccionarDiaParaNuevaInvitacion(fecha)}
            onSelectEvent={(event: any) => {
              setDiaSeleccionado('');
              setErrorEstado('');
              setErrorReunion('');
              if (event.resource.esReunion) {
                setCitaActiva(null);
                setReunionActiva(event.resource);
              } else {
                setReunionActiva(null);
                setCitaActiva(event.resource);
              }
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
        <div ref={panelRef} className="mt-5 border-t-2 border-numa-300 pt-5 scroll-mt-24">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-numa-600">Fecha y hora de la reunión</p>
              <p className="text-lg font-bold text-numa-900">
                {etiquetaFecha(citaActiva.fecha)} — {citaActiva.hora?.slice(0, 5)}
              </p>
              <p className="text-sm text-numa-700 mt-1">
                Estado:{' '}
                <span className="font-bold text-numa-900 capitalize">
                  {citaActiva.estado === 'no_realizada' ? 'no realizada' : citaActiva.estado}
                </span>
                {!citaActiva.proceso_id && citaActiva.partes_rapidas && (
                  <span className="ml-2 badge bg-numa-100 text-numa-800 font-semibold">
                    Invitación rápida · sin proceso
                  </span>
                )}
                {citaActiva.falta_tema && (
                  <span className="ml-2 badge bg-amber-100 text-amber-800">
                    Falta el tema
                  </span>
                )}
              </p>
              {citaActiva.mediador && (
                <p className="text-sm text-numa-700 mt-1">
                  Mediador: <span className="font-bold text-numa-900">{citaActiva.mediador}</span>
                </p>
              )}
              {citaActiva.fecha_creacion && (
                <p className="text-sm text-numa-700 mt-1">
                  Invitación creada el{' '}
                  <span className="font-bold text-numa-900">{fechaCreacionEC(citaActiva.fecha_creacion)}</span>
                  {citaActiva.creado_por && (
                    <>
                      {' '}por <span className="font-bold text-numa-900">{citaActiva.creado_por}</span>
                    </>
                  )}
                </p>
              )}
            </div>

            <span
              className={
                citaActiva.estado === 'pendiente'
                  ? 'badge bg-gold-100 text-gold-800 border border-gold-300 font-bold'
                  : citaActiva.estado === 'realizada'
                  ? 'badge bg-green-50 text-green-700'
                  : citaActiva.estado === 'no_realizada'
                  ? 'badge bg-stone-100 text-stone-700'
                  : citaActiva.estado === 'cancelada'
                  ? 'badge bg-red-50 text-red-700'
                  : 'badge bg-numa-100 text-numa-800 font-semibold'
              }
            >
              {citaActiva.estado === 'no_realizada' ? 'no realizada' : citaActiva.estado}
            </span>
          </div>

          <div className="bg-white border border-numa-300 border-l-4 border-l-gold-500 rounded-md shadow-sm px-4 py-3 mb-4 space-y-1 text-sm leading-snug">
            {citaActiva.falta_tema ? (
              <p>
                <span className="text-numa-700 font-semibold">Tema:</span>{' '}
                <span className="text-amber-700 font-semibold">pendiente de completar</span>
              </p>
            ) : (
              (citaActiva.documento_asunto ||
                (citaActiva.tema && citaActiva.tema !== 'Invitación rápida' ? citaActiva.tema : '')) && (
                <p>
                  <span className="text-numa-700 font-semibold">Tema:</span>{' '}
                  <span className="text-numa-900 font-semibold">
                    {citaActiva.documento_asunto ||
                      (citaActiva.tema !== 'Invitación rápida' ? citaActiva.tema : '')}
                  </span>
                </p>
              )
            )}

            {citaActiva.partes_rapidas && !citaActiva.proceso_id && (
              <>
                <p>
                  <span className="text-numa-700 font-semibold">Solicitante(s):</span>{' '}
                  <span className="text-numa-900 font-semibold">
                    {textoLadoRapido(citaActiva.partes_rapidas.solicitantes)}
                  </span>
                </p>
                <p>
                  <span className="text-numa-700 font-semibold">Invitado(s):</span>{' '}
                  <span className="text-numa-900 font-semibold">
                    {textoLadoRapido(citaActiva.partes_rapidas.invitados)}
                  </span>
                </p>
              </>
            )}

            {citaActiva.codigo_proceso && (
              <p>
                <span className="text-numa-700 font-semibold">Proceso:</span>{' '}
                <span className="text-numa-900 font-semibold">{citaActiva.codigo_proceso}</span>
              </p>
            )}

            {(citaActiva.demandante || citaActiva.demandado) &&
              !(citaActiva.partes_rapidas && !citaActiva.proceso_id) && (
              <p>
                <span className="text-numa-700 font-semibold">Partes:</span>{' '}
                <span className="text-numa-900 font-semibold">
                  {citaActiva.demandante}
                  {citaActiva.demandante_cedula && ` (${citaActiva.demandante_cedula})`}
                  {' y '}
                  {citaActiva.demandado}
                  {citaActiva.demandado_cedula && ` (${citaActiva.demandado_cedula})`}
                </span>
              </p>
            )}

            {citaActiva.sucursal && (
              <p>
                <span className="text-numa-700 font-semibold">Sucursal:</span>{' '}
                <span className="text-numa-900 font-semibold">
                  {citaActiva.sucursal}
                  {citaActiva.ciudad && ` — ${citaActiva.ciudad}`}
                  {citaActiva.provincia && `, ${citaActiva.provincia}`}
                </span>
              </p>
            )}

            {citaActiva.codigo_acta && (
              <p>
                <span className="text-numa-700 font-semibold">Acta vinculada:</span>{' '}
                <span className="text-numa-900 font-semibold">{citaActiva.codigo_acta}</span>
              </p>
            )}

            {citaActiva.observaciones && (
              <p>
                <span className="text-numa-700 font-semibold">Observaciones:</span>{' '}
                <span className="text-numa-900 whitespace-pre-line">{citaActiva.observaciones}</span>
              </p>
            )}

            {citaActiva.estado === 'cancelada' && citaActiva.motivo_cancelacion && (
              <p>
                <span className="text-numa-700 font-semibold">Motivo de cancelación:</span>{' '}
                <span className="text-numa-900">{citaActiva.motivo_cancelacion}</span>
              </p>
            )}
          </div>

          <HistorialInvitaciones citaId={citaActiva.id} procesoId={citaActiva.proceso_id} />

          {/* Línea de pasos de una invitación rápida pendiente: solo está activo
              lo que corresponde en cada momento. */}
          {citaActiva.partes_rapidas && !citaActiva.proceso_id && citaActiva.estado === 'pendiente' && (() => {
            const horaLlego =
              new Date(
                `${String(citaActiva.fecha).slice(0, 10)}T${String(citaActiva.hora).slice(0, 5)}:00-05:00`
              ).getTime() <= Date.now();
            const temaOk = !citaActiva.falta_tema;
            const docBloqueadoSecretaria =
              esSecretariaActual &&
              ['mediador', 'administrador'].includes(citaActiva.documento_editor_rol);
            const verDocumento = () =>
              router.push(`/procesos/rapida/invitacion-imprimir?cita=${citaActiva.id}`);
            const Paso = ({ n, hecho, titulo, children }: any) => (
              <li className="flex gap-3">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    hecho ? 'bg-green-600 text-white' : 'bg-numa-200 text-numa-700'
                  }`}
                >
                  {hecho ? '✓' : n}
                </span>
                <div className="min-w-0 flex-1 pb-3">
                  <p className="text-sm font-semibold text-numa-900">{titulo}</p>
                  <div className="text-xs text-numa-600 mt-0.5">{children}</div>
                </div>
              </li>
            );
            return (
              <ol className="mb-4 border border-numa-200 rounded-sm p-4 bg-white">
                <Paso n={1} hecho titulo="Invitación agendada">
                  {citaActiva.creado_por ? `Por ${citaActiva.creado_por}` : 'Agendada'}
                  {citaActiva.fecha_creacion ? ` · ${fechaCreacionEC(citaActiva.fecha_creacion)}` : ''}
                </Paso>
                <Paso n={2} hecho={temaOk} titulo="Tema de la invitación">
                  {temaOk ? (
                    'Tema completo.'
                  ) : (
                    <>
                      <p className="mb-2 text-amber-800">
                        Falta el asunto. Escríbelo en el documento de la invitación.
                      </p>
                      <button type="button" onClick={verDocumento} className="btn-secondary inline-flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Completar el tema en el documento
                      </button>
                    </>
                  )}
                </Paso>
                <Paso n={3} hecho={!!citaActiva.documento_editor_rol} titulo="Imprimir la invitación">
                  {temaOk ? (
                    <>
                      <p className="mb-2">
                        {docBloqueadoSecretaria
                          ? 'El mediador ya editó el documento: solo puedes verlo e imprimirlo.'
                          : 'Revisa el documento y descárgalo o imprímelo.'}
                      </p>
                      <button type="button" onClick={verDocumento} className="btn-secondary inline-flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Documento de la invitación
                      </button>
                    </>
                  ) : (
                    'Bloqueado: se habilita cuando el tema esté completo.'
                  )}
                </Paso>
                <Paso n={4} hecho={horaLlego} titulo="Reunión">
                  {etiquetaFecha(citaActiva.fecha)} — {citaActiva.hora?.slice(0, 5)}.{' '}
                  {horaLlego ? 'Ya es la hora de la reunión.' : 'Esperando la reunión.'}
                </Paso>
                <Paso n={5} hecho={false} titulo="Resultado">
                  {esSecretariaActual ? (
                    'El resultado lo define el mediador.'
                  ) : (
                    <>
                      <p className="mb-2">
                        {usuarioActual?.id === citaActiva.usuario_id
                          ? 'Si la reunión continúa, crea el proceso (puedes hacerlo antes de la hora). Si no, ciérrala sin proceso una vez realizada.'
                          : `Si la reunión continúa, ${citaActiva.mediador || 'el mediador'} crea el proceso. Si no, puedes cerrarla sin proceso una vez realizada.`}
                      </p>
                      <div className="flex flex-wrap gap-3 items-center">
                        {usuarioActual?.id === citaActiva.usuario_id ? (
                          <button
                            type="button"
                            onClick={() => router.push(`/procesos?crear=1&cita=${citaActiva.id}&directo=1`)}
                            className="btn-primary inline-flex items-center gap-2"
                          >
                            <FolderPlus className="w-4 h-4" />
                            Crear el proceso
                          </button>
                        ) : null}
                        {permitirGestionarEstado && (
                          <button
                            type="button"
                            disabled={!horaLlego || cambiandoEstado}
                            onClick={() => {
                              setNotaCierre('');
                              setMostrarCerrarSinProceso(true);
                            }}
                            className="btn-secondary disabled:opacity-50"
                          >
                            Cerrar sin proceso
                          </button>
                        )}
                        {permitirGestionarEstado && !horaLlego && (
                          <span>Se habilita cuando llegue la hora de la reunión.</span>
                        )}
                      </div>
                      {usuarioActual?.id !== citaActiva.usuario_id && citaActiva.numero_acta_codigo && (
                        <p className="mt-3 text-sm text-numa-800">
                          Número de acta de esta invitación:{' '}
                          <span className="font-mono font-bold">{citaActiva.numero_acta_codigo}</span>
                          {citaActiva.numero_acta_estado === 'anulado' ? ' (anulado)' : ''}
                        </p>
                      )}
                      {usuarioActual?.id === citaActiva.usuario_id && (
                        <div className="mt-3">
                          <PedirNumeroActaBoton
                            citaId={citaActiva.id}
                            numero={{ codigo: citaActiva.numero_acta_codigo, estado: citaActiva.numero_acta_estado }}
                            onPedido={() => cargarCitas()}
                          />
                        </div>
                      )}
                    </>
                  )}
                </Paso>
              </ol>
            );
          })()}

          {citaActiva.partes_rapidas && !citaActiva.proceso_id && citaActiva.estado !== 'pendiente' && citaActiva.estado !== 'cancelada' && (
            <div className="flex flex-wrap items-start gap-3 mb-4">
              <button
                type="button"
                onClick={() =>
                  router.push(`/procesos/rapida/invitacion-imprimir?cita=${citaActiva.id}`)
                }
                className="btn-secondary inline-flex items-center gap-2"
              >
                <FileText className="w-4 h-4" />
                Ver documento
              </button>
            </div>
          )}

          {errorEstado && (
            <div className="mb-3">
              <ErrorAlert message={errorEstado} />
            </div>
          )}

          {citaActiva.estado === 'pendiente' &&
          (permitirGestionarEstado ||
            (esSecretariaActual ? secretariaPuedeCancelar(citaActiva) : permitirCancelar)) ? (
            <div className="flex flex-wrap items-center gap-3">
              {permitirGestionarEstado && !!citaActiva.proceso_id && (
                <p className="text-sm text-numa-700 w-full">
                  El resultado de esta invitación se registra dentro del proceso (en "Registrar
                  avance"), no desde aquí.
                </p>
              )}

              {!!citaActiva.proceso_id && !esSecretariaActual && (
                <button
                  type="button"
                  onClick={() => router.push(`/procesos/${citaActiva.proceso_id}`)}
                  className="btn-primary"
                >
                  Ir al proceso
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
            <p className="text-sm text-numa-700">
              Esta invitación está pendiente.
              {esSecretariaActual && ' Solo el mediador puede cancelarla o registrar su resultado.'}
            </p>
          ) : (
            <p className="text-sm text-numa-700">
              Esta invitación ya no está pendiente, por lo que no ocupa esa hora para una nueva invitación.
            </p>
          )}
        </div>
      )}

      {/* Detalle de una reunión de mediadores */}
      {reunionActiva && !citaActiva && !diaSeleccionado && (
        <div ref={panelRef} className="mt-5 border-t border-numa-100 pt-5 scroll-mt-24">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-numa-800 capitalize flex items-center gap-2">
                <Users className="w-4 h-4 text-violet-600" />
                {reunionActiva.titulo}
              </p>
              <p className="text-sm text-numa-700 mt-0.5">
                {etiquetaFecha(String(reunionActiva.fecha).slice(0, 10))} · de{' '}
                {horaCorta(reunionActiva.hora_inicio)} a {horaCorta(reunionActiva.hora_fin)}
              </p>
            </div>
            <span className="badge bg-violet-50 text-violet-700">Reunión de mediadores</span>
          </div>

          {reunionActiva.detalle && (
            <p className="text-sm text-numa-700 bg-numa-50 border border-numa-100 rounded-sm p-3 mb-3">
              {reunionActiva.detalle}
            </p>
          )}

          <p className="text-xs text-numa-500 mb-3">
            Todos los mediadores de la sucursal están convocados. En este horario no se pueden
            agendar invitaciones.
            {reunionActiva.creado_por && <> Creada por {reunionActiva.creado_por}.</>}
          </p>

          {errorReunion && (
            <div className="mb-3">
              <ErrorAlert message={errorReunion} />
            </div>
          )}

          {avisoReunion.length > 0 && (
            <div className="mb-3 border border-amber-300 bg-amber-50 rounded-sm p-3 text-xs text-amber-900">
              <p className="font-semibold mb-1">
                Atención: estos mediadores ya tienen una invitación pendiente en ese horario.
              </p>
              <ul className="list-disc ml-5">
                {avisoReunion.map((a: any) => (
                  <li key={a.id}>
                    {a.mediador} — {horaCorta(a.hora)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {esAdminActual && (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setEditandoReunion(true)}
                className="btn-secondary"
              >
                Cambiar horario o datos
              </button>
              <button
                type="button"
                onClick={() => {
                  setMotivoReunion('');
                  setErrorReunion('');
                  setCancelandoReunion(true);
                }}
                className="btn-secondary text-red-600 hover:bg-red-50"
              >
                Cancelar reunión
              </button>
            </div>
          )}
        </div>
      )}

      {/* Citas del día seleccionado (clic en un día vacío o en "+N más") */}
      {diaSeleccionado && !citaActiva && (
        <div id="panel-dia-agenda" ref={panelRef} className="mt-5 border-t border-numa-100 pt-5 scroll-mt-24">
          <p className="text-sm font-semibold text-numa-800 mb-2">
            {etiquetaFecha(diaSeleccionado)}
          </p>

          {citasDelDia.length > 0 ? (
            <div className="flex flex-wrap gap-2 mb-4">
              {citasDelDia.map((c) => {
                const partes = [c.demandante, c.demandado].filter(Boolean).join(' y ');
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
                        : c.estado === 'no_realizada'
                        ? 'badge bg-stone-100 text-stone-700 hover:bg-stone-200'
                        : c.estado === 'cancelada'
                        ? 'badge bg-red-50 text-red-700 hover:bg-red-100'
                        : 'badge bg-numa-100 text-numa-700 hover:bg-numa-200'
                    }
                  >
                    {c.hora?.slice(0, 5)} · {c.estado === 'no_realizada' ? 'no realizada' : c.estado}
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

          {reunionesDelDia.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {reunionesDelDia.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setDiaSeleccionado('');
                    setReunionActiva(r);
                  }}
                  className="badge bg-violet-50 text-violet-700 hover:bg-violet-100"
                >
                  {horaCorta(r.hora_inicio)}-{horaCorta(r.hora_fin)} · {r.titulo}
                </button>
              ))}
            </div>
          )}

          {/* Elegir fecha/hora para una cita NUEVA — solo si se permite crear */}
          {permitirCrear && diaSeleccionado < hoyISO() && (
            <p className="text-[13px] font-medium text-numa-700 rounded-sm border border-numa-200 bg-numa-50 px-3 py-2">
              Esta fecha ya pasó: no se pueden agendar invitaciones nuevas en fechas anteriores a hoy.
            </p>
          )}
          {permitirCrear && diaSeleccionado >= hoyISO() && (
            <div className="flex flex-wrap items-end gap-4">
              <InputField
                label="Hora para la nueva invitación"
                type="time"
                value={horaSeleccionada}
                min={esHoy ? horaActual() : undefined}
                onChange={(e) => setHoraSeleccionada(e.target.value)}
                error={
                  reunionEnLaHora
                    ? `Esa hora está ocupada: reunión de mediadores de ${horaCorta(
                        reunionEnLaHora.hora_inicio
                      )} a ${horaCorta(reunionEnLaHora.hora_fin)}`
                    : horaYaOcupada
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

      <ReunionModal
        open={editandoReunion}
        reunion={reunionActiva}
        onClose={() => setEditandoReunion(false)}
        onGuardada={(res: any) => {
          setEditandoReunion(false);
          setReunionActiva(res.reunion);
          setAvisoReunion(res.conflictos || []);
          cargarCitas();
        }}
      />

      <Modal
        open={cancelandoReunion}
        onClose={() => setCancelandoReunion(false)}
        title="Cancelar reunión de mediadores"
        size="sm"
      >
        <p className="text-sm text-numa-700 mb-4">
          Se avisará a los mediadores y a la secretaria que la reunión se canceló, y esa hora
          volverá a quedar libre.
        </p>
        <TextareaField
          label="Motivo (opcional)"
          rows={2}
          value={motivoReunion}
          onChange={(e) => setMotivoReunion(e.target.value)}
        />
        <div className="flex gap-3 justify-end mt-6">
          <button onClick={() => setCancelandoReunion(false)} className="btn-secondary text-sm">
            Volver
          </button>
          <button
            className="btn-danger text-sm"
            onClick={async () => {
              try {
                await cancelarReunion(reunionActiva.id, motivoReunion.trim() || undefined);
                setCancelandoReunion(false);
                setReunionActiva(null);
                setAvisoReunion([]);
                await cargarCitas();
              } catch (err: any) {
                setCancelandoReunion(false);
                setErrorReunion(err?.response?.data?.detail || 'No se pudo cancelar la reunión');
              }
            }}
          >
            Sí, cancelar reunión
          </button>
        </div>
      </Modal>

      <Modal
        open={mostrarCerrarSinProceso}
        onClose={() => setMostrarCerrarSinProceso(false)}
        title="Cerrar sin crear proceso"
        size="sm"
      >
        <p className="text-sm text-numa-800 mb-4">
          La invitación quedará como realizada y se cerrará sin crear proceso de mediación ni acta.
          Si la reunión continúa, usa «Crear el proceso». Esta acción no se puede deshacer.
        </p>
        {citaActiva?.numero_acta_codigo && (
          <p className="text-sm text-numa-800 mb-4">
            Esta invitación tiene el número de acta {citaActiva.numero_acta_codigo}. Si cierras sin
            proceso, ese número se anula solo y queda registrado. Si después la reunión continúa, solo el
            administrador puede reactivarlo.
          </p>
        )}

        <TextareaField
          label="Observación (opcional)"
          rows={3}
          value={notaCierre}
          onChange={(e) => setNotaCierre(e.target.value)}
          placeholder="Ejemplo: La parte solicitante desistió, no se abrió trámite..."
        />

        <div className="flex gap-3 justify-end mt-6">
          <button onClick={() => setMostrarCerrarSinProceso(false)} className="btn-secondary text-sm">
            Volver
          </button>
          <button
            onClick={confirmarCierreSinProceso}
            disabled={cambiandoEstado}
            className="btn-primary text-sm"
          >
            {cambiandoEstado ? 'Procesando...' : 'Sí, cerrar sin proceso'}
          </button>
        </div>
      </Modal>

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
        {citaActiva?.numero_acta_codigo && (
          <p className="text-sm text-numa-800 mb-4">
            Esta invitación tiene el número de acta {citaActiva.numero_acta_codigo}. Al cancelarla, ese
            número se anula solo y queda registrado.
          </p>
        )}

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
