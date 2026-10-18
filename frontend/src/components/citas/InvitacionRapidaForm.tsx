'use client';

import { useState } from 'react';
import { Plus, Trash2, Zap } from 'lucide-react';
import { InputField, TextareaField, ErrorAlert } from '@/components/ui';
import { crearInvitacionRapida } from '@/lib/services';

// Cédula ecuatoriana (mismo cálculo que en Clientes).
const cedulaValida = (cedula: string) => {
  if (!/^\d{10}$/.test(cedula)) return false;
  const provincia = parseInt(cedula.slice(0, 2), 10);
  if (provincia < 1 || provincia > 24) return false;
  if (parseInt(cedula[2], 10) >= 6) return false;
  const coef = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let v = parseInt(cedula[i], 10) * coef[i];
    if (v >= 10) v -= 9;
    suma += v;
  }
  return (10 - (suma % 10)) % 10 === parseInt(cedula[9], 10);
};

type Persona = { nombre: string; cedula: string };
type Empresa = {
  razon_social: string;
  ruc: string;
  representante_nombre: string;
  representante_cedula: string;
};
type Lado = { modo: 'personas' | 'empresa'; personas: Persona[]; empresa: Empresa };

const ladoVacio = (): Lado => ({
  modo: 'personas',
  personas: [{ nombre: '', cedula: '' }],
  empresa: { razon_social: '', ruc: '', representante_nombre: '', representante_cedula: '' }
});

const soloDigitos = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

function LadoEditor({
  titulo,
  lado,
  onChange
}: {
  titulo: string;
  lado: Lado;
  onChange: (l: Lado) => void;
}) {
  const setPersona = (i: number, campo: keyof Persona, valor: string) =>
    onChange({
      ...lado,
      personas: lado.personas.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p))
    });
  const setEmpresa = (campo: keyof Empresa, valor: string) =>
    onChange({ ...lado, empresa: { ...lado.empresa, [campo]: valor } });

  return (
    <div className="border border-numa-100 rounded-sm p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h4 className="text-sm font-semibold text-numa-800">{titulo}</h4>
        <div className="inline-flex rounded-sm border border-numa-200 overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => onChange({ ...lado, modo: 'personas' })}
            className={`px-3 py-1.5 ${
              lado.modo === 'personas' ? 'bg-numa-800 text-white' : 'bg-white text-numa-600'
            }`}
          >
            Personas
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...lado, modo: 'empresa' })}
            className={`px-3 py-1.5 ${
              lado.modo === 'empresa' ? 'bg-numa-800 text-white' : 'bg-white text-numa-600'
            }`}
          >
            Empresa
          </button>
        </div>
      </div>

      {lado.modo === 'personas' ? (
        <div className="space-y-3">
          {lado.personas.map((p, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_190px_auto] gap-3 items-end">
              <InputField
                label={i === 0 ? 'Nombres y apellidos' : `Nombres y apellidos (${i + 1})`}
                value={p.nombre}
                onChange={(e) => setPersona(i, 'nombre', e.target.value)}
                placeholder="Nombre completo"
              />
              <InputField
                label="Cédula"
                inputMode="numeric"
                value={p.cedula}
                onChange={(e) => setPersona(i, 'cedula', soloDigitos(e.target.value, 10))}
                placeholder="10 dígitos"
                error={
                  p.cedula.length === 10 && !cedulaValida(p.cedula) ? 'Cédula inválida' : undefined
                }
              />
              {lado.personas.length > 1 ? (
                <button
                  type="button"
                  aria-label="Quitar persona"
                  onClick={() =>
                    onChange({ ...lado, personas: lado.personas.filter((_, idx) => idx !== i) })
                  }
                  className="p-2 mb-0.5 text-red-600 hover:bg-red-50 rounded-sm"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({ ...lado, personas: [...lado.personas, { nombre: '', cedula: '' }] })
            }
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-600 hover:text-gold-700"
          >
            <Plus className="w-3.5 h-3.5" />
            Agregar otra persona
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InputField
            label="Razón social"
            value={lado.empresa.razon_social}
            onChange={(e) => setEmpresa('razon_social', e.target.value)}
          />
          <InputField
            label="RUC (opcional)"
            inputMode="numeric"
            value={lado.empresa.ruc}
            onChange={(e) => setEmpresa('ruc', soloDigitos(e.target.value, 13))}
            placeholder="13 dígitos"
          />
          <InputField
            label="Representante legal"
            value={lado.empresa.representante_nombre}
            onChange={(e) => setEmpresa('representante_nombre', e.target.value)}
            placeholder="Nombres y apellidos"
          />
          <InputField
            label="Cédula del representante legal"
            inputMode="numeric"
            value={lado.empresa.representante_cedula}
            onChange={(e) => setEmpresa('representante_cedula', soloDigitos(e.target.value, 10))}
            error={
              lado.empresa.representante_cedula.length === 10 &&
              !cedulaValida(lado.empresa.representante_cedula)
                ? 'Cédula inválida'
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}

const aPayload = (l: Lado) =>
  l.modo === 'empresa'
    ? [
        {
          tipo: 'empresa',
          razon_social: l.empresa.razon_social.trim(),
          ruc: l.empresa.ruc,
          representante_nombre: l.empresa.representante_nombre.trim(),
          representante_cedula: l.empresa.representante_cedula
        }
      ]
    : l.personas.map((p) => ({ tipo: 'persona', nombre: p.nombre.trim(), cedula: p.cedula }));

const revisarLado = (l: Lado, etiqueta: string): string => {
  if (l.modo === 'empresa') {
    const e = l.empresa;
    if (!e.razon_social.trim()) return `Escribe la razón social de la empresa (${etiqueta}).`;
    if (e.ruc && e.ruc.length !== 13) return 'El RUC debe tener 13 dígitos.';
    if (!e.representante_nombre.trim())
      return `Escribe el nombre del representante legal (${etiqueta}).`;
    if (!cedulaValida(e.representante_cedula))
      return `La cédula del representante legal (${etiqueta}) no es válida.`;
    return '';
  }
  for (const p of l.personas) {
    if (!p.nombre.trim()) return `Falta el nombre de una persona (${etiqueta}).`;
    if (!cedulaValida(p.cedula))
      return `La cédula de ${p.nombre.trim() || 'una persona'} (${etiqueta}) no es válida.`;
  }
  return '';
};

export default function InvitacionRapidaForm({
  fecha,
  hora,
  usuarioId,
  onCreada,
  onCancelar
}: {
  fecha: string;
  hora: string;
  usuarioId?: number;
  onCreada: (cita: any) => void;
  onCancelar: () => void;
}) {
  const [solicitantes, setSolicitantes] = useState<Lado>(ladoVacio());
  const [invitados, setInvitados] = useState<Lado>(ladoVacio());
  const [tema, setTema] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const crear = async () => {
    const problema =
      revisarLado(solicitantes, 'solicitante') || revisarLado(invitados, 'invitado');
    if (problema) {
      setError(problema);
      return;
    }
    if (!observaciones.trim()) {
      setError('Debes ingresar una observación para la invitación.');
      return;
    }

    setGuardando(true);
    setError('');
    try {
      const cita = await crearInvitacionRapida({
        fecha,
        hora,
        observaciones: observaciones.trim(),
        tema: tema.trim() || undefined,
        usuario_id: usuarioId,
        solicitantes: aPayload(solicitantes),
        invitados: aPayload(invitados)
      });
      onCreada(cita);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'No se pudo crear la invitación rápida.');
    } finally {
      setGuardando(false);
    }
  };

  const fechaTexto = new Date(`${fecha}T00:00:00`).toLocaleDateString('es-EC', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  return (
    <div className="mt-5 border-t border-numa-100 pt-5">
      <h3 className="text-sm font-semibold text-numa-800 mb-1 flex items-center gap-2">
        <Zap className="w-4 h-4 text-gold-600" />
        Invitación rápida
      </h3>
      <p className="text-sm text-numa-700 mb-1">
        <span className="font-semibold capitalize">{fechaTexto}</span> a las{' '}
        <span className="font-semibold">{hora}</span>.
      </p>
      <p className="text-xs text-numa-500 mb-4">
        No crea el proceso: la reunión queda en la Agenda. El proceso se crea después y se enlaza a
        esta invitación.
      </p>

      <div className="space-y-4">
        <LadoEditor titulo="Solicitante(s)" lado={solicitantes} onChange={setSolicitantes} />
        <LadoEditor titulo="Invitado(s)" lado={invitados} onChange={setInvitados} />

        <InputField
          label="Tema (opcional)"
          value={tema}
          onChange={(e) => setTema(e.target.value)}
          placeholder="Ejemplo: Deuda por préstamo..."
        />

        <TextareaField
          label="Observaciones"
          rows={3}
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Ejemplo: Primera invitación a reunión de mediación..."
        />
      </div>

      {error && (
        <div className="mt-3">
          <ErrorAlert message={error} />
        </div>
      )}

      <div className="flex flex-wrap gap-3 mt-4">
        <button
          type="button"
          onClick={crear}
          disabled={guardando}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {guardando ? 'Guardando...' : 'Crear invitación'}
        </button>
        <button type="button" onClick={onCancelar} className="btn-secondary">
          Cancelar
        </button>
      </div>
    </div>
  );
}
