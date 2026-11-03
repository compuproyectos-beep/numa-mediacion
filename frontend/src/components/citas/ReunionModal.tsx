'use client';

import { useEffect, useState } from 'react';
import { Modal, InputField, TextareaField, SelectField, ErrorAlert } from '@/components/ui';
import { crearReunion, editarReunion } from '@/lib/services';

// Fecha local en formato AAAA-MM-DD (sin pasar por UTC: en Ecuador, después
// de las 19:00 toISOString() ya devuelve el día siguiente).
const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
};

const sumarMinutos = (hora: string, minutos: number) => {
  const [h, m] = hora.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return hora;
  const total = Math.min(h * 60 + m + minutos, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// Crear (reunion = null) o cambiar (reunion = la existente) una reunión de
// mediadores. La reunión es para TODOS los mediadores de la sucursal del
// administrador: no se elige a quién.
export default function ReunionModal({
  open,
  reunion,
  sucursales,
  sucursalInicial,
  onClose,
  onGuardada,
}: {
  open: boolean;
  reunion?: any | null;
  // Sucursales entre las que el administrador puede elegir al crear.
  sucursales?: { id: number; nombre: string; ciudad?: string; mediadores: number; secretarias?: number }[];
  sucursalInicial?: number | string | null;
  onClose: () => void;
  onGuardada: (resultado: { reunion: any; conflictos: any[] }) => void;
}) {
  const [titulo, setTitulo] = useState('Reunión de mediadores');
  const [detalle, setDetalle] = useState('');
  const [fecha, setFecha] = useState('');
  const [horaInicio, setHoraInicio] = useState('10:00');
  const [horaFin, setHoraFin] = useState('11:00');
  const [sucursalId, setSucursalId] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (reunion) {
      setTitulo(reunion.titulo || 'Reunión de mediadores');
      setDetalle(reunion.detalle || '');
      setFecha(String(reunion.fecha).slice(0, 10));
      setHoraInicio(String(reunion.hora_inicio).slice(0, 5));
      setHoraFin(String(reunion.hora_fin).slice(0, 5));
    } else {
      setTitulo('Reunión de mediadores');
      setDetalle('');
      setFecha('');
      setHoraInicio('10:00');
      setHoraFin('11:00');
      setSucursalId(sucursalInicial ? String(sucursalInicial) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reunion]);

  const guardar = async () => {
    if (!reunion && sucursales && sucursales.length > 0 && !sucursalId) {
      setError('Elige la sucursal de la reunión.');
      return;
    }
    if (!fecha) {
      setError('Elige la fecha de la reunión.');
      return;
    }
    if (!horaInicio || !horaFin || horaFin <= horaInicio) {
      setError('La hora de fin debe ser posterior a la hora de inicio.');
      return;
    }

    setGuardando(true);
    setError('');
    try {
      const payload = {
        fecha,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        titulo: titulo.trim() || undefined,
        detalle: detalle.trim() || undefined,
        ...(!reunion && sucursalId ? { sucursal_id: Number(sucursalId) } : {}),
      };
      const res = reunion ? await editarReunion(reunion.id, payload) : await crearReunion(payload);
      onGuardada(res);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'No se pudo guardar la reunión.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={reunion ? 'Cambiar reunión de mediadores' : 'Nueva reunión de mediadores'}
      size="md"
    >
      <p className="text-xs text-numa-700 mb-4">
        {sucursales && sucursales.length > 0
          ? 'La reunión es para todos los mediadores y la secretaria de la sucursal que elijas'
          : 'La reunión es para todos los mediadores y la secretaria de tu sucursal'}
        : cada uno recibe una notificación y verá la reunión en su agenda. En ese horario no se
        podrán agendar invitaciones.
      </p>

      <div className="space-y-4">
        {!reunion && sucursales && sucursales.length > 0 && (
          <SelectField
            label="Sucursal de la reunión"
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
          >
            <option value="">Elige la sucursal</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
                {s.ciudad ? ` — ${s.ciudad}` : ''} ({s.mediadores}{' '}
                {s.mediadores === 1 ? 'mediador' : 'mediadores'}
                {s.secretarias
                  ? ` y ${s.secretarias} ${s.secretarias === 1 ? 'secretaria' : 'secretarias'}`
                  : ''})
              </option>
            ))}
          </SelectField>
        )}

        <InputField label="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} />

        <InputField
          label="Fecha"
          type="date"
          min={hoyLocal()}
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Hora de inicio"
            type="time"
            value={horaInicio}
            onChange={(e) => {
              const nueva = e.target.value;
              setHoraInicio(nueva);
              // Si el fin queda antes del nuevo inicio, se corre a 1 hora después.
              if (nueva && horaFin <= nueva) setHoraFin(sumarMinutos(nueva, 60));
            }}
          />
          <InputField
            label="Hora de fin"
            type="time"
            value={horaFin}
            onChange={(e) => setHoraFin(e.target.value)}
          />
        </div>

        <TextareaField
          label="Detalle (opcional)"
          rows={2}
          value={detalle}
          onChange={(e) => setDetalle(e.target.value)}
          placeholder="Ejemplo: Revisión de casos del mes, en la oficina 101..."
        />
      </div>

      {error && (
        <div className="mt-3">
          <ErrorAlert message={error} />
        </div>
      )}

      <div className="flex gap-3 justify-end mt-6">
        <button type="button" onClick={onClose} className="btn-secondary text-sm">
          Volver
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={guardando}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {guardando ? 'Guardando...' : reunion ? 'Guardar cambios' : 'Crear reunión'}
        </button>
      </div>
    </Modal>
  );
}
