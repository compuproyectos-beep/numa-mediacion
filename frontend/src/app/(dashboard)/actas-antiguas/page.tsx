'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Spinner, ErrorAlert, InputField, SelectField } from '@/components/ui';
import { getSucursales, getUsuarios, getClientes, registrarActaAntigua } from '@/lib/services';
import { isAdmin } from '@/lib/auth';

type Parte = {
  tipo: 'persona' | 'empresa';
  cedula: string;
  nombre: string;
  apellido: string;
  ruc: string;
  razon_social: string;
  representante_nombre: string;
  representante_cedula: string;
};

const parteVacia = (): Parte => ({
  tipo: 'persona', cedula: '', nombre: '', apellido: '', ruc: '',
  razon_social: '', representante_nombre: '', representante_cedula: '',
});

function mensajeError(e: any): string {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x: any) => x?.msg).filter(Boolean).join('. ');
  return 'No se pudo registrar el acta. Intenta de nuevo.';
}

const norm = (t: string) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function aParte(ex: any): Parte {
  return ex.tipo === 'empresa'
    ? { ...parteVacia(), tipo: 'empresa', ruc: ex.ruc || '', razon_social: ex.razon_social || ex.nombre || '',
        representante_nombre: ex.representante_nombre || '', representante_cedula: ex.representante_cedula || '' }
    : { ...parteVacia(), tipo: 'persona', cedula: ex.cedula || '', nombre: ex.nombre || '', apellido: ex.apellido || '' };
}

function EditorPartes({ titulo, partes, onChange, clientes }: { titulo: string; partes: Parte[]; onChange: (p: Parte[]) => void; clientes: any[] }) {
  const [foco, setFoco] = useState<{ i: number; campo: keyof Parte } | null>(null);

  const set = (i: number, campo: keyof Parte, valor: string) => {
    const nuevas = partes.map((p, idx) => (idx === i ? { ...p, [campo]: valor } : p));
    // Si la cédula o el RUC está completo y ya existe, se llenan solos los demás datos.
    const p = nuevas[i];
    const ex =
      campo === 'cedula' && valor.length === 10 ? clientes.find((c) => c.cedula === valor)
      : campo === 'ruc' && valor.length === 13 ? clientes.find((c) => c.ruc === valor)
      : null;
    onChange(ex ? nuevas.map((x, idx) => (idx === i ? aParte(ex) : x)) : nuevas);
    void p;
  };

  const sugerencias = (i: number): any[] => {
    if (!foco || foco.i !== i) return [];
    const p = partes[i];
    const v = norm(String(p[foco.campo] || '')).trim();
    const esNum = foco.campo === 'cedula' || foco.campo === 'ruc' || foco.campo === 'representante_cedula';
    if (v.length < (esNum ? 3 : 2)) return [];
    return clientes
      .filter((c) => (c.tipo === 'empresa') === (p.tipo === 'empresa'))
      .filter((c) => {
        const campos = c.tipo === 'empresa'
          ? { ruc: c.ruc, razon_social: c.razon_social || c.nombre, representante_nombre: c.representante_nombre, representante_cedula: c.representante_cedula }
          : { cedula: c.cedula, nombre: `${c.nombre} ${c.apellido}`, apellido: `${c.nombre} ${c.apellido}` };
        const txt = norm(String((campos as any)[foco.campo] || ''));
        return esNum ? txt.startsWith(v) : txt.includes(v);
      })
      .slice(0, 6);
  };

  const etiqueta = (c: any) =>
    c.tipo === 'empresa'
      ? `${c.razon_social || c.nombre} · RUC ${c.ruc}${c.representante_nombre ? ` · Rep.: ${c.representante_nombre}` : ''}`
      : `${c.nombre} ${c.apellido} · C.I. ${c.cedula}`;

  const yaExiste = (p: Parte) =>
    clientes.some((c) => (p.tipo === 'empresa' ? p.ruc.length === 13 && c.ruc === p.ruc : p.cedula.length === 10 && c.cedula === p.cedula));

  const f = (i: number, campo: keyof Parte) => ({
    onFocus: () => setFoco({ i, campo }),
    onBlur: () => setFoco((x) => (x && x.i === i && x.campo === campo ? null : x)),
    autoComplete: 'off',
  });

  return (
    <div className="card p-4 space-y-4">
      <p className="text-base font-bold text-numa-900">{titulo}</p>
      {partes.map((p, i) => {
        const sug = sugerencias(i);
        return (
          <div key={i} className="space-y-3 border-b border-numa-100 pb-4 last:border-0 last:pb-0">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <SelectField label={`Persona ${i + 1}`} value={p.tipo} onChange={(e) => onChange(partes.map((x, idx) => (idx === i ? { ...parteVacia(), tipo: e.target.value as any } : x)))}>
                  <option value="persona">Persona natural</option>
                  <option value="empresa">Empresa o institución</option>
                </SelectField>
              </div>
              {partes.length > 1 && (
                <button type="button" className="btn-secondary btn-sm" onClick={() => onChange(partes.filter((_, idx) => idx !== i))}>
                  Quitar
                </button>
              )}
            </div>
            {p.tipo === 'persona' ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <InputField label="Cédula" value={p.cedula} maxLength={10} {...f(i, 'cedula')} onChange={(e) => set(i, 'cedula', e.target.value.replace(/\D/g, ''))} />
                <InputField label="Nombres" value={p.nombre} {...f(i, 'nombre')} onChange={(e) => set(i, 'nombre', e.target.value)} />
                <InputField label="Apellidos" value={p.apellido} {...f(i, 'apellido')} onChange={(e) => set(i, 'apellido', e.target.value)} />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <InputField label="RUC" value={p.ruc} maxLength={13} {...f(i, 'ruc')} onChange={(e) => set(i, 'ruc', e.target.value.replace(/\D/g, ''))} />
                <InputField label="Razón social" value={p.razon_social} {...f(i, 'razon_social')} onChange={(e) => set(i, 'razon_social', e.target.value)} />
                <InputField label="Cédula del representante" value={p.representante_cedula} maxLength={10} {...f(i, 'representante_cedula')} onChange={(e) => set(i, 'representante_cedula', e.target.value.replace(/\D/g, ''))} />
                <InputField label="Representante legal" value={p.representante_nombre} {...f(i, 'representante_nombre')} onChange={(e) => set(i, 'representante_nombre', e.target.value)} />
              </div>
            )}
            {sug.length > 0 && (
              <div className="rounded-xl border border-numa-200 bg-white shadow-sm overflow-hidden">
                <p className="px-3 py-1.5 text-xs text-numa-500 bg-numa-50">Ya registrados en el sistema: toca uno para usarlo, o sigue escribiendo.</p>
                {sug.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange(partes.map((x, idx) => (idx === i ? aParte(c) : x)));
                      setFoco(null);
                    }}
                    className="block w-full text-left px-3 py-2 text-sm text-numa-900 hover:bg-gold-50 border-t border-numa-100"
                  >
                    {etiqueta(c)}
                  </button>
                ))}
              </div>
            )}
            {yaExiste(p) && <p className="text-xs text-green-700">Ya está registrado en el sistema: se usan sus datos.</p>}
          </div>
        );
      })}
      <button type="button" className="btn-secondary btn-sm" onClick={() => onChange([...partes, parteVacia()])}>
        + Agregar otra persona
      </button>
    </div>
  );
}

export default function ActasAntiguasPage() {
  const router = useRouter();
  const admin = isAdmin();
  const [loading, setLoading] = useState(true);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [sucursalId, setSucursalId] = useState('');
  const [mediadorId, setMediadorId] = useState('');
  const [numero, setNumero] = useState('');
  const [fecha, setFecha] = useState('');
  const [tipo, setTipo] = useState<'acuerdo' | 'no_acuerdo'>('acuerdo');
  const [tema, setTema] = useState('');
  const [solicitantes, setSolicitantes] = useState<Parte[]>([parteVacia()]);
  const [invitados, setInvitados] = useState<Parte[]>([parteVacia()]);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [claveArchivo, setClaveArchivo] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    if (!admin) router.replace('/dashboard');
  }, [admin, router]);

  useEffect(() => {
    Promise.all([getSucursales(true), getUsuarios(), getClientes()])
      .then(([s, u, c]) => {
        setSucursales(s);
        setUsuarios(u);
        setClientes(c);
        const matriz = s.find((x: any) => x.id === 18) || s[0];
        if (matriz) setSucursalId(String(matriz.id));
      })
      .catch(() => setError('No se pudieron cargar las sucursales y los usuarios'))
      .finally(() => setLoading(false));
  }, []);

  const mediadores = usuarios.filter(
    (u) => String(u.sucursal_id) === sucursalId && u.activo !== false && ['mediador', 'administrador'].includes(u.rol)
  );

  useEffect(() => {
    if (mediadores.length && !mediadores.some((m) => String(m.id) === mediadorId)) {
      setMediadorId(String(mediadores[0].id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursalId, usuarios]);

  const limpiarPartes = (ps: Parte[]) =>
    ps.map((p) =>
      p.tipo === 'persona'
        ? { tipo: 'persona', cedula: p.cedula.trim(), nombre: p.nombre.trim(), apellido: p.apellido.trim() }
        : {
            tipo: 'empresa', ruc: p.ruc.trim(), razon_social: p.razon_social.trim(),
            representante_nombre: p.representante_nombre.trim(), representante_cedula: p.representante_cedula.trim(),
          }
    );

  const guardar = async () => {
    setError('');
    setOk('');
    if (!numero || !fecha || !tema.trim() || !archivo || !mediadorId) {
      setError('Completa el número, la fecha, el tema, el mediador y sube el PDF del acta.');
      return;
    }
    setGuardando(true);
    try {
      const r = await registrarActaAntigua({
        sucursalId: Number(sucursalId),
        mediadorId: Number(mediadorId),
        numero: Number(numero),
        fecha,
        tipo,
        tema: tema.trim(),
        partes: { solicitantes: limpiarPartes(solicitantes), invitados: limpiarPartes(invitados) },
        archivo,
      });
      setOk(`Listo: se registró el acta ${r.codigo_acta}.`);
      getClientes().then(setClientes).catch(() => {});
      setNumero('');
      setFecha('');
      setTema('');
      setTipo('acuerdo');
      setSolicitantes([parteVacia()]);
      setInvitados([parteVacia()]);
      setArchivo(null);
      setClaveArchivo((k) => k + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  if (!admin) return null;
  if (loading) return <Spinner />;

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        title="Registrar actas antiguas"
        subtitle="Para actas físicas de antes del sistema: solo el PDF, el número, la fecha y las partes. No piden facturas ni comprobantes."
      />
      {error && <ErrorAlert message={error} />}
      {ok && <div className="card p-4 border-green-200 bg-green-50 text-green-800 text-sm font-semibold">{ok}</div>}

      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField label="Sucursal" value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>{s.ciudad ? `${s.ciudad} - ` : ''}{s.nombre}</option>
            ))}
          </SelectField>
          <SelectField label="Mediador del acta" value={mediadorId} onChange={(e) => setMediadorId(e.target.value)}>
            {mediadores.map((m) => (
              <option key={m.id} value={m.id}>{m.nombre} {m.apellido}</option>
            ))}
          </SelectField>
          <InputField label="Número del acta (ej. 12 para ACTA No. 012-2026)" type="number" min={1} value={numero} onChange={(e) => setNumero(e.target.value)} />
          <InputField label="Fecha que aparece en el acta" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          <SelectField label="Resultado" value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
            <option value="acuerdo">Acta de acuerdo</option>
            <option value="no_acuerdo">Acta de no acuerdo</option>
          </SelectField>
          <InputField label="Tema (ej. ALIMENTOS)" value={tema} onChange={(e) => setTema(e.target.value)} />
        </div>
      </div>

      <EditorPartes titulo="Solicitantes" partes={solicitantes} onChange={setSolicitantes} clientes={clientes} />
      <EditorPartes titulo="Invitados" partes={invitados} onChange={setInvitados} clientes={clientes} />

      <div className="card p-4 space-y-2">
        <label className="label">Acta en PDF</label>
        <input
          key={claveArchivo}
          type="file"
          accept="application/pdf"
          className="input-field"
          onChange={(e) => setArchivo(e.target.files?.[0] || null)}
        />
      </div>

      <button type="button" className="btn-primary" onClick={guardar} disabled={guardando}>
        {guardando ? 'Guardando...' : 'Registrar acta'}
      </button>
    </div>
  );
}
