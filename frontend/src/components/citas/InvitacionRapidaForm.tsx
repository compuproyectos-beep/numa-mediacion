'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Zap } from 'lucide-react';
import { InputField, TextareaField, ErrorAlert } from '@/components/ui';
import { crearInvitacionRapida, getClientes } from '@/lib/services';

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

// registrado = los datos salieron de un cliente que ya existe en el sistema.
type Persona = { nombre: string; cedula: string; registrado?: boolean };
type Empresa = {
  razon_social: string;
  ruc: string;
  representante_nombre: string;
  representante_cedula: string;
  registrado?: boolean;
};
type Lado = { modo: 'personas' | 'empresa'; personas: Persona[]; empresa: Empresa };

const ladoVacio = (): Lado => ({
  modo: 'personas',
  personas: [{ nombre: '', cedula: '' }],
  empresa: { razon_social: '', ruc: '', representante_nombre: '', representante_cedula: '' }
});

const soloDigitos = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

const nombreCompleto = (c: any) => `${c.nombre || ''} ${c.apellido || ''}`.trim();

function LadoEditor({
  titulo,
  lado,
  clientes,
  onChange
}: {
  titulo: string;
  lado: Lado;
  clientes: any[];
  onChange: (l: Lado) => void;
}) {
  const setPersona = (i: number, campo: keyof Persona, valor: string) =>
    onChange({
      ...lado,
      personas: lado.personas.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p))
    });

  // Al completar la cédula se busca si la persona ya está en el sistema: si
  // está, se llena sola (así no se vuelve a crear con un nombre mal escrito).
  const cambiarCedulaPersona = (i: number, valor: string) =>
    onChange({
      ...lado,
      personas: lado.personas.map((p, idx) => {
        if (idx !== i) return p;
        const enc =
          valor.length === 10
            ? clientes.find((c) => c.tipo !== 'empresa' && c.cedula === valor)
            : null;
        if (enc) return { nombre: nombreCompleto(enc), cedula: valor, registrado: true };
        return { nombre: p.registrado ? '' : p.nombre, cedula: valor, registrado: false };
      })
    });

  // Igual con la empresa, por su RUC.
  const cambiarRuc = (valor: string) => {
    const enc =
      valor.length === 13
        ? clientes.find((c) => c.tipo === 'empresa' && c.ruc === valor)
        : null;
    if (enc) {
      onChange({
        ...lado,
        empresa: {
          razon_social: enc.razon_social || '',
          ruc: valor,
          representante_nombre: enc.representante_nombre || '',
          representante_cedula: enc.representante_cedula || '',
          registrado: true
        }
      });
    } else if (lado.empresa.registrado) {
      onChange({
        ...lado,
        empresa: {
          razon_social: '',
          ruc: valor,
          representante_nombre: '',
          representante_cedula: '',
          registrado: false
        }
      });
    } else {
      onChange({ ...lado, empresa: { ...lado.empresa, ruc: valor } });
    }
  };

  const setEmpresa = (campo: keyof Empresa, valor: string) => {
    const empresa = { ...lado.empresa, [campo]: valor };
    // Si la cédula del representante ya es de un cliente registrado, se
    // sugiere su nombre.
    if (campo === 'representante_cedula' && valor.length === 10 && !empresa.representante_nombre.trim()) {
      const enc = clientes.find((c) => c.tipo !== 'empresa' && c.cedula === valor);
      if (enc) empresa.representante_nombre = nombreCompleto(enc);
    }
    onChange({ ...lado, empresa });
  };

  const ultima = lado.personas[lado.personas.length - 1];
  const puedeAgregar = !!ultima && !!ultima.nombre.trim() && cedulaValida(ultima.cedula);

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
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[minmax(0,380px)_190px_auto] gap-3 items-end">
              <InputField
                label={i === 0 ? 'Nombres y apellidos' : `Nombres y apellidos (${i + 1})`}
                value={p.nombre}
                onChange={(e) => setPersona(i, 'nombre', e.target.value)}
                placeholder="Nombre completo"
                disabled={!!p.registrado}
              />
              <InputField
                label="Cédula"
                inputMode="numeric"
                value={p.cedula}
                onChange={(e) => cambiarCedulaPersona(i, soloDigitos(e.target.value, 10))}
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
              {p.registrado && (
                <p className="sm:col-span-3 -mt-1 text-xs text-green-700">
                  ✔ Ya está registrada en el sistema: se usaron sus datos. Si la cédula no es la
                  correcta, corrígela.
                </p>
              )}
            </div>
          ))}
          <button
            type="button"
            disabled={!puedeAgregar}
            onClick={() =>
              onChange({ ...lado, personas: [...lado.personas, { nombre: '', cedula: '' }] })
            }
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-600 hover:text-gold-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gold-600"
          >
            <Plus className="w-3.5 h-3.5" />
            Agregar otra persona
          </button>
          {!puedeAgregar && (
            <p className="text-xs text-numa-400">
              Para agregar otra persona, completa primero el nombre y una cédula válida de la
              anterior.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InputField
            label="Razón social"
            value={lado.empresa.razon_social}
            onChange={(e) => setEmpresa('razon_social', e.target.value)}
            disabled={!!lado.empresa.registrado}
          />
          <InputField
            label="RUC (opcional)"
            inputMode="numeric"
            value={lado.empresa.ruc}
            onChange={(e) => cambiarRuc(soloDigitos(e.target.value, 13))}
            placeholder="13 dígitos"
          />
          <InputField
            label="Representante legal"
            value={lado.empresa.representante_nombre}
            onChange={(e) => setEmpresa('representante_nombre', e.target.value)}
            placeholder="Nombres y apellidos"
            disabled={!!lado.empresa.registrado}
          />
          <InputField
            label="Cédula del representante legal"
            inputMode="numeric"
            value={lado.empresa.representante_cedula}
            onChange={(e) => setEmpresa('representante_cedula', soloDigitos(e.target.value, 10))}
            disabled={!!lado.empresa.registrado}
            error={
              lado.empresa.representante_cedula.length === 10 &&
              !cedulaValida(lado.empresa.representante_cedula)
                ? 'Cédula inválida'
                : undefined
            }
          />
          {lado.empresa.registrado && (
            <p className="sm:col-span-2 text-xs text-green-700">
              ✔ Esta empresa ya está registrada en el sistema: se usaron sus datos. Si el RUC no
              es el correcto, corrígelo.
            </p>
          )}
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
  temaObligatorio = true,
  onCreada,
  onCancelar
}: {
  fecha: string;
  hora: string;
  usuarioId?: number;
  // El tema se cobra con la invitación: los mediadores y el administrador
  // deben escribirlo; la secretaria puede dejarlo en blanco y el mediador
  // lo completa después en el documento.
  temaObligatorio?: boolean;
  onCreada: (cita: any) => void;
  onCancelar: () => void;
}) {
  const [clientes, setClientes] = useState<any[]>([]);

  // Clientes ya registrados, para reconocerlos por la cédula o el RUC.
  useEffect(() => {
    getClientes()
      .then((c) => setClientes(c as any[]))
      .catch(() => setClientes([]));
  }, []);

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
    const cedulas = [solicitantes, invitados].flatMap((l) =>
      l.modo === 'empresa' ? [l.empresa.representante_cedula] : l.personas.map((p) => p.cedula)
    );
    const repetida = cedulas.find((c, i) => c && cedulas.indexOf(c) !== i);
    if (repetida) {
      setError(`La cédula ${repetida} está repetida: una misma persona no puede aparecer dos veces.`);
      return;
    }
    if (temaObligatorio && !tema.trim()) {
      setError('Escribe el tema a tratar en la reunión.');
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
        <LadoEditor
          titulo="Solicitante(s)"
          lado={solicitantes}
          clientes={clientes}
          onChange={setSolicitantes}
        />
        <LadoEditor
          titulo="Invitado(s)"
          lado={invitados}
          clientes={clientes}
          onChange={setInvitados}
        />

        <InputField
          label={temaObligatorio ? 'Tema a tratar' : 'Tema (opcional, el mediador puede completarlo)'}
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
