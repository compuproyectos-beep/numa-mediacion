'use client';

import { useEffect, useMemo, useState } from 'react';
import { Calendar, dateFnsLocalizer, Views, View } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';

import {
  Plus,
  Clock,
  XCircle,
  CalendarClock
} from 'lucide-react';


import {
  PageHeader,
  Spinner,
  EmptyState,
  ErrorAlert,
  Modal,
  SelectField,
  InputField,
  TextareaField,
  Badge
} from '@/components/ui';

import {
  getCitas,
  createCita,
  cambiarEstadoCita,
  reagendarCita,
  getClientes,
  getActas
} from '@/lib/services';
import { getCiudadesCached, getSucursalesCached } from '@/lib/catalogCache';

import { useAuth } from '@/hooks/useAuth';

const locales = { es };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales
});

export default function CitasPage() {
  const { isAdmin } = useAuth();

  const [citas, setCitas] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [ciudades, setCiudades] = useState<any[]>([]);
  const [actas, setActas] = useState<any[]>([]);

  const [ciudadSucursalId, setCiudadSucursalId] = useState('');
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedDayEvents, setSelectedDayEvents] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarView, setCalendarView] = useState<View>(Views.MONTH);

  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [showReagendar, setShowReagendar] = useState(false);
  const [citaReagendar, setCitaReagendar] = useState<any | null>(null);

  const [reagendarForm, setReagendarForm] = useState({
    fecha: '',
    hora: '',
    motivo: ''
  });

  const [form, setForm] = useState({
    cliente_demandante_id: '',
    cliente_demandado_id: '',
    sucursal_id: '',
    acta_id: '',
    fecha: '',
    hora: '',
    tema: '',
    observaciones: ''
  });

  const load = async () => {
    setLoading(true);

    try {
      const [
        citasData,
        clientesData,
        sucursalesData,
        actasData,
        ciudadesData
      ] = await Promise.all([
        getCitas(),
        getClientes(),
        getSucursalesCached(),
        getActas(),
        getCiudadesCached()
      ]);

      setCitas(citasData);
      setClientes(clientesData);
      setSucursales(sucursalesData);
      setActas(actasData);
      setCiudades(ciudadesData);
    } catch (err) {
      console.error(err);
      setError('Error cargando citas');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const sucursalesActivas = sucursales.filter((s: any) => {
    return s.activo ?? s.activa;
  });

  const ciudadesConSucursales = ciudades.filter((c: any) =>
    sucursalesActivas.some(
      (s: any) => Number(s.ciudad_id) === Number(c.id)
    )
  );

  const sucursalesFiltradas = ciudadSucursalId
    ? sucursalesActivas.filter(
        (s: any) => Number(s.ciudad_id) === Number(ciudadSucursalId)
      )
    : [];

  const resetForm = () => {
    setForm({
      cliente_demandante_id: '',
      cliente_demandado_id: '',
      sucursal_id: '',
      acta_id: '',
      fecha: '',
      hora: '',
      tema: '',
      observaciones: ''
    });

    setCiudadSucursalId('');
    setFormError('');
    setError('');
  };

  const handleCreate = async () => {
    setFormError('');
    setError('');

    if (
      !form.cliente_demandante_id ||
      !form.cliente_demandado_id ||
      (isAdmin && !form.sucursal_id) ||
      !form.fecha ||
      !form.hora ||
      !form.tema
    ) {
      setFormError('Completa todos los campos obligatorios');
      return;
    }

    if (form.cliente_demandante_id === form.cliente_demandado_id) {
      setFormError('Los clientes deben ser diferentes');
      return;
    }

    setSaving(true);

    try {
      await createCita({
        cliente_demandante_id: Number(form.cliente_demandante_id),
        cliente_demandado_id: Number(form.cliente_demandado_id),
        sucursal_id: form.sucursal_id
          ? Number(form.sucursal_id)
          : undefined,
        acta_id: form.acta_id
          ? Number(form.acta_id)
          : undefined,
        fecha: form.fecha,
        hora: form.hora,
        tema: form.tema,
        observaciones: form.observaciones
      });

      setShowCreate(false);
      resetForm();
      load();
    } catch (err: any) {
      console.error(err);

      setFormError(
        err?.response?.data?.detail ||
          'Error creando cita'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReagendar = async () => {
    if (!citaReagendar) return;

    if (
      !reagendarForm.fecha ||
      !reagendarForm.hora ||
      !reagendarForm.motivo.trim()
    ) {
      setFormError('Completa fecha, hora y motivo');
      return;
    }

    setSaving(true);
    setFormError('');

    try {
      await reagendarCita(citaReagendar.id, reagendarForm);

      setShowReagendar(false);
      setCitaReagendar(null);
      setReagendarForm({
        fecha: '',
        hora: '',
        motivo: ''
      });

      load();
    } catch (err: any) {
      console.error(err);

      setFormError(
        err?.response?.data?.detail ||
          'Error reagendando cita'
      );
    } finally {
      setSaving(false);
    }
  };

  const actualizarEstado = async (citaId: number, estado: string) => {
    try {
      await cambiarEstadoCita(citaId, estado);
      load();
    } catch (err) {
      console.error(err);
      setError('Error actualizando cita');
    }
  };

  const estadoBadge = (estado: string) => {
    switch (estado) {
      case 'realizada':
        return 'aprobado';
      case 'cancelada':
        return 'rechazado';
      case 'reagendada':
        return 'enviado';
      default:
        return 'enviado';
    }
  };

  const eventos = useMemo(() => {
    return citas.map((cita) => {
      const fechaHora = new Date(`${cita.fecha}T${cita.hora}`);
      const fin = new Date(fechaHora);
      fin.setHours(fin.getHours() + 1);

      return {
        id: cita.id,
        title: `${cita.tema}`,
        start: fechaHora,
        end: fin,
        resource: cita
      };
    });
  }, [citas]);

  return (
    <>
      <PageHeader
        title="Agenda de Invitaciones"
        subtitle="Gestión de audiencias y reuniones"
        action={
          <button
            onClick={() => {
              resetForm();
              setShowCreate(true);
            }}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
            Nueva Invitación
          </button>
        }
      />

      {error && !showCreate && !showReagendar && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}

      <div className="card p-4 mb-6 overflow-hidden">
        {loading ? (
          <Spinner />
        ) : (
          <div className="h-[700px] overflow-hidden">
              <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCalendarView(Views.MONTH)}
            className={`btn-secondary ${
              calendarView === Views.MONTH ? 'bg-numa-100' : ''
            }`}
          >
            Mes
          </button>

          <button
            type="button"
            onClick={() => setCalendarView(Views.WEEK)}
            className={`btn-secondary ${
              calendarView === Views.WEEK ? 'bg-numa-100' : ''
            }`}
          >
            Semana
          </button>

          <button
            type="button"
            onClick={() => setCalendarView(Views.DAY)}
            className={`btn-secondary ${
              calendarView === Views.DAY ? 'bg-numa-100' : ''
            }`}
          >
            Día
          </button>
        </div>

            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex gap-2">
                <SelectField
                  label=""
                  value={String(calendarDate.getMonth())}
                  onChange={(e) =>
                    setCalendarDate(
                      new Date(
                        calendarDate.getFullYear(),
                        Number(e.target.value),
                        1
                      )
                    )
                  }
                >
                  {[
                    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
                  ].map((m, index) => (
                    <option key={m} value={index}>
                      {m}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label=""
                  value={String(calendarDate.getFullYear())}
                  onChange={(e) =>
                    setCalendarDate(
                      new Date(
                        Number(e.target.value),
                        calendarDate.getMonth(),
                        1
                      )
                    )
                  }
                >
                  {Array.from(
                    { length: 8 },
                    (_, i) => new Date().getFullYear() - 1 + i
                  ).map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </SelectField>
              </div>

              <button
                type="button"
                onClick={() => setCalendarDate(new Date())}
                className="btn-secondary"
              >
                Hoy
              </button>
            </div>

            <Calendar
              localizer={localizer}
              date={calendarDate}
              view={calendarView}
              onNavigate={(date) => setCalendarDate(date)}
              onView={(view) => setCalendarView(view)}
              toolbar={false}
              selectable
              longPressThreshold={1}
              onSelectSlot={(slotInfo: any) => {
                const fecha = new Date(slotInfo.start)
                  .toISOString()
                  .slice(0, 10);

               const citasDelDia = citas.filter(
                  (c) => c.fecha === fecha
                );

                if (citasDelDia.length > 0) {
                setSelectedDate(fecha);
            setSelectedDayEvents(citasDelDia);
            setShowDayModal(true);
            return;
              }
             setForm({
                ...form,
                fecha,
                hora: '09:00'
              });

              setShowCreate(true);
            }}
            

              startAccessor="start"
              endAccessor="end"
              culture="es"
              defaultView={Views.MONTH}
              views={[Views.MONTH, Views.WEEK, Views.DAY]}
              events={eventos}
              messages={{
                next: 'Siguiente',
                previous: 'Anterior',
                today: 'Hoy',
                month: 'Mes',
                week: 'Semana',
                day: 'Día',
                agenda: 'Agenda',
                date: 'Fecha',
                time: 'Hora',
                event: 'Evento',
                noEventsInRange: 'No hay invitaciones'
              }}
              onSelectEvent={(event: any) => {
                const cita = event.resource;

                setError(
                  `${cita.tema} — ${cita.demandante} vs ${cita.demandado} — ${cita.fecha} ${cita.hora}`
                );
              }}
            />
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner />
        ) : citas.length === 0 ? (
          <EmptyState message="No hay invitaciones registradas." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-numa-50 border-b border-numa-100">
                <tr>
                  <th className="table-header">Fecha</th>
                  <th className="table-header">Hora</th>
                  <th className="table-header">Tema</th>
                  <th className="table-header">Partes</th>
                  <th className="table-header">Sucursal</th>
                  <th className="table-header">Estado</th>
                  <th className="table-header">Acciones</th>
                </tr>
              </thead>

              <tbody>
                {citas.map((cita) => (
                  <tr key={cita.id} className="table-row">
                    <td className="table-cell">
                    {cita.fecha?.split('-').reverse().join('/')}              
                    </td>

                    <td className="table-cell">
                      {cita.hora?.slice(0, 5)}
                    </td>

                    <td className="table-cell font-medium">
                      {cita.tema}
                    </td>

                    <td className="table-cell">
                      <div>
                        <div className="font-medium text-numa-700">
                          {cita.demandante}
                        </div>

                        <div className="text-xs text-numa-400">
                          vs {cita.demandado}
                        </div>
                      </div>
                    </td>

                    <td className="table-cell">
                      {cita.sucursal}
                    </td>

                    <td className="table-cell">
              <Badge
                label={cita.estado}
                variant={estadoBadge(cita.estado)}
              />
            </td>

            <td className="table-cell">
              <div className="flex gap-2 flex-wrap">
                {cita.estado === 'cancelada' ? (
                  <span className="text-xs text-numa-400">
                    Sin acciones
                  </span>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setCitaReagendar(cita);
                        setReagendarForm({
                          fecha: cita.fecha,
                          hora: cita.hora?.slice(0, 5) || '',
                          motivo: ''
                        });
                        setFormError('');
                        setShowReagendar(true);
                      }}
                      className="btn-ghost text-xs py-1 px-2"
                    >
                      <CalendarClock className="w-3 h-3" />
                      Reagendar
                    </button>

                    <button
                      onClick={() =>
                        actualizarEstado(cita.id, 'realizada')
                      }
                      className="btn-ghost text-xs py-1 px-2"
                    >
                      <Clock className="w-3 h-3" />
                      Realizada
                    </button>

                    <button
                      onClick={() =>
                        actualizarEstado(cita.id, 'cancelada')
                      }
                      className="btn-ghost text-xs py-1 px-2 text-red-600"
                    >
                      <XCircle className="w-3 h-3" />
                      Cancelar
                    </button>
                   </>
                    )}
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
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          resetForm();
        }}
        title="Nueva Invitación"
        size="lg"
      >

        <Modal
          open={showDayModal}
          onClose={() => setShowDayModal(false)}
          title={`Invitaciones del ${selectedDate}`}
          size="lg"
        >
          <div className="space-y-3 max-h-[70vh] overflow-y-auto">

            {selectedDayEvents.length === 0 ? (
              <EmptyState message="No hay invitaciones este día." />
            ) : (
              selectedDayEvents.map((cita: any) => (
                <div
                  key={cita.id}
                  className="border border-numa-100 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-numa-800">
                        {cita.tema}
                      </h3>

                      <p className="text-sm text-numa-500">
                        {cita.hora?.slice(0, 5)}
                      </p>
                    </div>

                    <Badge
                      label={cita.estado}
                      variant={estadoBadge(cita.estado)}
                    />
                  </div>

                  <div className="mt-3 text-sm text-numa-600">
                    <p>
                      <strong>Partes:</strong>{' '}
                      {cita.demandante} vs {cita.demandado}
                    </p>

                    <p>
                      <strong>Sucursal:</strong>{' '}
                      {cita.sucursal}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Modal>

        <div className="max-h-[70vh] overflow-y-auto pr-2">
          <div className="space-y-4">
            {formError && (
              <ErrorAlert message={formError} />
            )}

            <SelectField
              label="Solicitante"
              value={form.cliente_demandante_id}
              onChange={(e) =>
                setForm({
                  ...form,
                  cliente_demandante_id: e.target.value
                })
              }
            >
              <option value="">Seleccione</option>

              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} {c.apellido}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Invitado"
              value={form.cliente_demandado_id}
              onChange={(e) =>
                setForm({
                  ...form,
                  cliente_demandado_id: e.target.value
                })
              }
            >
              <option value="">Seleccione</option>

              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} {c.apellido}
                </option>
              ))}
            </SelectField>

            {isAdmin && (
              <>
                <SelectField
                  label="Ciudad"
                  value={ciudadSucursalId}
                  onChange={(e) => {
                    setCiudadSucursalId(e.target.value);

                    setForm({
                      ...form,
                      sucursal_id: ''
                    });
                  }}
                >
                  <option value="">Seleccione una ciudad</option>

                  {ciudadesConSucursales.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label="Sucursal"
                  value={form.sucursal_id}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      sucursal_id: e.target.value
                    })
                  }
                  disabled={!ciudadSucursalId}
                >
                  <option value="">Seleccione</option>

                  {sucursalesFiltradas.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </SelectField>
              </>
            )}

            <SelectField
              label="Vincular Acta (opcional)"
              value={form.acta_id}
              onChange={(e) =>
                setForm({
                  ...form,
                  acta_id: e.target.value
                })
              }
            >
              <option value="">Sin acta vinculada</option>

              {actas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.codigo_acta}
                </option>
              ))}
            </SelectField>

            <TextareaField
              label="Tema"
              rows={3}
              value={form.tema}
              onChange={(e) =>
                setForm({
                  ...form,
                  tema: e.target.value
                })
              }
              placeholder="Ejemplo: Audiencia inicial por acuerdo de pago"
            />

            <InputField
              label="Fecha"
              type="date"
              value={form.fecha}
              onChange={(e) =>
                setForm({
                  ...form,
                  fecha: e.target.value
                })
              }
            />

            <InputField
              label="Hora"
              type="time"
              value={form.hora}
              onChange={(e) =>
                setForm({
                  ...form,
                  hora: e.target.value
                })
              }
            />

            <TextareaField
              label="Observaciones"
              rows={3}
              value={form.observaciones}
              onChange={(e) =>
                setForm({
                  ...form,
                  observaciones: e.target.value
                })
              }
            />
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => {
                setShowCreate(false);
                resetForm();
              }}
              className="btn-secondary"
            >
              Cancelar
            </button>

            <button
              onClick={handleCreate}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? 'Guardando...' : 'Crear Invitación'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showReagendar}
        onClose={() => {
          setShowReagendar(false);
          setCitaReagendar(null);
          setFormError('');
        }}
        title="Reagendar Invitación"
      >
        <div className="space-y-4">
          {formError && <ErrorAlert message={formError} />}

          <InputField
            label="Nueva fecha"
            type="date"
            value={reagendarForm.fecha}
            onChange={(e) =>
              setReagendarForm({
                ...reagendarForm,
                fecha: e.target.value
              })
            }
          />

          <InputField
            label="Nueva hora"
            type="time"
            value={reagendarForm.hora}
            onChange={(e) =>
              setReagendarForm({
                ...reagendarForm,
                hora: e.target.value
              })
            }
          />

          <TextareaField
            label="Motivo de la reagendación"
            rows={3}
            value={reagendarForm.motivo}
            onChange={(e) =>
              setReagendarForm({
                ...reagendarForm,
                motivo: e.target.value
              })
            }
            placeholder="Ejemplo: Las partes solicitaron cambiar la fecha"
          />
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={() => {
              setShowReagendar(false);
              setCitaReagendar(null);
              setFormError('');
            }}
            className="btn-secondary"
          >
            Cancelar
          </button>

          <button
            onClick={handleReagendar}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? 'Guardando...' : 'Reagendar'}
          </button>
        </div>
      </Modal>
    </>
  );
}