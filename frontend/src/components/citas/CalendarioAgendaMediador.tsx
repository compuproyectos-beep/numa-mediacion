'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';

import { InputField, Spinner, ErrorAlert, ConfirmDialog } from '@/components/ui';
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

const hoyISO = () => new Date().toISOString().slice(0, 10);
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
}

export default function CalendarioAgendaMediador({
  usuarioId,
  mediadorNombre,
  onConfirmar,
  permitirCrear = true,
  permitirGestionarEstado = true,
  permitirCancelar = false,
  onCitaActualizada,
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
      `${c.hora?.slice(0, 5) ?? ''} · ${c.estado}`,
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

  const handleCambiarEstado = async (nuevoEstado: string) => {
    if (!citaActiva) return;

    setCambiandoEstado(true);
    setErrorEstado('');

    try {
      await cambiarEstadoCita(citaActiva.id, nuevoEstado);
      await cargarCitas();
      setCitaActiva({ ...citaActiva, estado: nuevoEstado });
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
    setMostrarConfirmarCancelar(true);
  };

  const confirmarCancelacion = () => {
    setMostrarConfirmarCancelar(false);
    handleCambiarEstado('cancelada');
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
        <div className="h-[440px]">
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
              const fechaISO = new Date(fecha).toISOString().slice(0, 10);
              setCitaActiva(null);
              setErrorEstado('');
              setDiaSeleccionado(fechaISO);
              setHoraSeleccionada(fechaISO === hoyISO() ? '' : '09:00');
            }}
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
              return esPasado
                ? { style: { backgroundColor: '#F8FAFC', color: '#B9C4D3' } }
                : {};
            }}
            eventPropGetter={(event: any) => ({
              style: {
                backgroundColor: colorPorEstado[event.resource.estado] || '#4A6789',
                color: event.resource.estado === 'pendiente' ? '#0E2338' : '#fff',
                border: 'none',
                fontSize: '11px',
                fontWeight: 600,
              },
            })}
            onSelectSlot={(slotInfo: any) => {
              if (!permitirCrear) return;

              const fecha = new Date(slotInfo.start).toISOString().slice(0, 10);

              // No se puede agendar una cita nueva en una fecha pasada
              if (fecha < hoyISO()) return;

              setCitaActiva(null);
              setErrorEstado('');
              setDiaSeleccionado(fecha);
              setHoraSeleccionada(fecha === hoyISO() ? '' : '09:00');
            }}
            onSelectEvent={(event: any) => {
              setDiaSeleccionado('');
              setErrorEstado('');
              setCitaActiva(event.resource);
            }}
          />
        </div>
      )}

      {/* Detalle y gestión de una cita existente */}
      {citaActiva && (
        <div className="mt-5 border-t border-numa-100 pt-5">
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
        <div className="mt-5 border-t border-numa-100 pt-5">
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

      <ConfirmDialog
        open={mostrarConfirmarCancelar}
        onClose={() => setMostrarConfirmarCancelar(false)}
        onConfirm={confirmarCancelacion}
        loading={cambiandoEstado}
        confirmLabel="Sí, cancelar invitación"
        message={
          citaActiva
            ? `¿Seguro que quieres cancelar la invitación del ${etiquetaFecha(
                citaActiva.fecha
              )} a las ${citaActiva.hora?.slice(0, 5)}? Esta acción no se puede deshacer.`
            : ''
        }
      />
    </div>
  );
}
