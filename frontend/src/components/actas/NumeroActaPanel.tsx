'use client';

import { useEffect, useState } from 'react';
import { Hash, Copy, Check, Ban, Lock, Clock } from 'lucide-react';
import { ConfirmDialog, ErrorAlert, Modal, TextareaField } from '@/components/ui';
import {
  getMiNumeroActa,
  getNumerosActaAdmin,
  anularNumeroActa,
  pedirAnulacionNumeroActa,
  reactivarNumeroActa,
  desbloquearActa
} from '@/lib/services';

// Las fechas vienen del servidor en UTC: se muestran en hora de Ecuador.
const fechaEC = (v: any) => {
  if (!v) return '—';
  const iso = String(v).replace(' ', 'T');
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-EC', {
    timeZone: 'America/Guayaquil',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Convierte la fecha límite en "23 h 10 min" (o null si ya pasó).
export function tiempoRestante(venceEn: any, ahora: number): { texto: string; urgente: boolean } | null {
  if (!venceEn) return null;
  const iso = String(venceEn).replace(' ', 'T');
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  if (isNaN(d.getTime())) return null;
  const ms = d.getTime() - ahora;
  if (ms <= 0) return null;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return { texto: `${h} h ${String(m).padStart(2, '0')} min`, urgente: h < 6 };
}

// Reloj que se actualiza solo cada medio minuto para las cuentas regresivas.
export function useAhora(): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  return ahora;
}

// Reloj en vivo que cuenta hacia atrás cada segundo, con tarjetas rojas de horas, minutos y
// segundos (estilo reloj de cuenta regresiva). Tiene su propio temporizador para que solo se
// repinte este pedacito y no toda la pantalla. `pequeno` es la versión para tablas.
export function CuentaRegresiva({ venceEn, pequeno = false }: { venceEn: any; pequeno?: boolean }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const iso = String(venceEn || '').replace(' ', 'T');
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  const ms = isNaN(d.getTime()) ? 0 : Math.max(0, d.getTime() - ahora);
  const seg = Math.floor(ms / 1000);
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const sg = seg % 60;
  const p = (n: number) => String(n).padStart(2, '0');

  const bloque = (valor: string, etiqueta: string) => (
    <div className="flex flex-col items-center">
      <div
        className={`relative flex items-center justify-center rounded-lg bg-red-700 text-white font-mono font-bold tabular-nums shadow-[0_6px_14px_-6px_rgba(153,27,27,0.7)] ${
          pequeno ? 'w-9 h-9 text-base' : 'w-11 h-11 text-2xl'
        }`}
      >
        {valor}
      </div>
      <span
        className={`uppercase tracking-wide font-semibold text-red-800 ${
          pequeno ? 'text-[9px] mt-0.5' : 'text-[10px] mt-1'
        }`}
      >
        {etiqueta}
      </span>
    </div>
  );
  const separador = (
    <span
      className={`font-bold text-red-700 ${pequeno ? 'text-base pb-3' : 'text-xl pb-4'}`}
      aria-hidden="true"
    >
      :
    </span>
  );

  return (
    <div
      role="timer"
      aria-label={`${h} horas ${m} minutos ${sg} segundos`}
      className="inline-flex items-start gap-1"
    >
      {bloque(p(h), 'Horas')}
      {separador}
      {bloque(p(m), 'Min')}
      {separador}
      {bloque(p(sg), 'Seg')}
    </div>
  );
}

export default function NumeroActaPanel({ esAdmin }: { esAdmin: boolean }) {
  // El administrador es un mediador más: pide sus números igual que ellos
  // (sin bloqueos) y además ve y puede anular los de todos. Los dos cuadros
  // se refrescan juntos cuando cualquiera cambia algo.
  const [version, setVersion] = useState(0);
  const refrescar = () => setVersion((v) => v + 1);
  return (
    <>
      {/* El administrador ve un solo cuadro (vencidos de todos, incluidos los suyos);
          los mediadores, el suyo. Así no se repite la misma información. */}
      {esAdmin ? (
        <PanelAdmin version={version} onCambio={refrescar} />
      ) : (
        <PanelMediador version={version} onCambio={refrescar} />
      )}
    </>
  );
}

/* ───────────────────────── Mediador ───────────────────────── */
// A qué está ligado un número: el proceso (con enlace) o la invitación rápida.
function Ligado({ n }: { n: any }) {
  if (n.ligado_a === 'proceso') {
    return (
      <span className="text-sm text-slate-900 font-medium">
        Proceso{' '}
        <a href={`/procesos/${n.proceso_id}`} className="underline font-semibold">
          {n.proceso_codigo}
        </a>
        {n.ligado_detalle ? ` · ${n.ligado_detalle}` : ''}
      </span>
    );
  }
  if (n.ligado_a === 'invitacion') {
    return (
      <span className="text-sm text-slate-900 font-medium">
        Invitación rápida · {n.ligado_detalle}
      </span>
    );
  }
  return <span className="text-sm text-slate-800">Sin proceso ni invitación</span>;
}

function PanelMediador({ version }: { version: number; onCambio: () => void }) {
  const [estado, setEstado] = useState<any | null>(null);
  const [copiado, setCopiado] = useState<number | null>(null);
  const [verAnulados, setVerAnulados] = useState(false);
  const ahora = useAhora();
  // Pedir al administrador que anule un número (queda registrado y avisa).
  const [pedir, setPedir] = useState<any | null>(null);
  const [motivoPedido, setMotivoPedido] = useState('');
  const [enviandoPedido, setEnviandoPedido] = useState(false);
  const [errorPedido, setErrorPedido] = useState('');
  const [okPedido, setOkPedido] = useState('');
  const enviarPedido = async () => {
    if (!pedir) return;
    if (motivoPedido.trim().length < 5) {
      setErrorPedido('Escribe el motivo del pedido');
      return;
    }
    setEnviandoPedido(true);
    setErrorPedido('');
    try {
      await pedirAnulacionNumeroActa(pedir.id, motivoPedido.trim());
      setPedir(null);
      setMotivoPedido('');
      setOkPedido('Pedido enviado al administrador y a la secretaria. Quedó registrado.');
    } catch (e: any) {
      setErrorPedido(e?.response?.data?.detail || 'No se pudo enviar el pedido');
    } finally {
      setEnviandoPedido(false);
    }
  };

  const cargar = () =>
    getMiNumeroActa().then(setEstado).catch(() => setEstado(null));

  useEffect(() => {
    cargar();
  }, [version]);

  const copiar = async (id: number, texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(id);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      /* si el navegador no deja copiar, el número sigue visible */
    }
  };

  if (!estado) return null;

  const reservados: any[] = estado.reservados || [];
  const anulados: any[] = estado.anulados || [];
  const bloqueados: any[] = estado.bloqueados || [];
  const vencidos = reservados.filter((r) => r.vencido).length;

  return (
    <div className="card px-5 py-4 mb-4 bg-white border border-[#C5D2E6] border-t-4 border-t-gold-400 shadow-[0_14px_30px_-22px_rgba(10,42,98,0.5)]">
      <div className="flex items-center gap-2 mb-1">
        <Hash size={18} className="text-gold-700" />
        <p className="font-semibold text-slate-900">
          Mis números de acta pendientes por completar ({reservados.length})
          {vencidos > 0 && <span className="text-red-600"> · {vencidos} vencido{vencidos === 1 ? '' : 's'}</span>}
        </p>
      </div>
      <p className="text-sm text-slate-700 mb-2">
        Tienes 48 horas desde que se te da el número para subir todos los documentos del acta. Pasado ese plazo,
        el acta se bloquea y solo el administrador puede desbloquearla. El número se asigna al cerrar un proceso
        o al pedirlo en una invitación rápida de la Agenda.
      </p>

      {bloqueados.length > 0 && (
        <div className="mb-3 rounded-xl border border-red-300 bg-red-50 px-3.5 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-red-800">
            <Lock size={16} /> Tienes {bloqueados.length} acta{bloqueados.length === 1 ? '' : 's'} bloqueada{bloqueados.length === 1 ? '' : 's'}
          </p>
          <p className="text-sm text-red-900 mt-1">
            Pasaron 48 horas sin completarla. Mientras tanto no puedes pedir números de acta ni subir otras actas.
            Pide al administrador que la desbloquee. Abajo, en «Ver números de actas bloqueadas», está el detalle.
          </p>
        </div>
      )}

      {estado.motivo && bloqueados.length === 0 && <p className="text-sm text-amber-700 mb-2">{estado.motivo}</p>}

      {reservados.length === 0 ? (
        <p className="text-sm text-slate-900">No tienes números de acta pendientes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-900 bg-[#F4F7FC]">
                <th className="py-2 pl-3 pr-3 rounded-l-lg">Número</th>
                <th className="py-2 pr-3">Pedido</th>
                <th className="py-2 pr-3">Plazo</th>
                <th className="py-2 rounded-r-lg" />
              </tr>
            </thead>
            <tbody>
              {reservados.map((r) => (
                <tr key={r.id} className="border-t border-[#C5D2E6] odd:bg-white even:bg-[#F8FAFD]">
                  <td className="py-2.5 pl-3 pr-3 font-mono font-semibold">
                    {r.codigo}
                    <span className="block font-sans text-xs font-normal text-slate-700">
                      <Ligado n={r} />
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">{fechaEC(r.fecha_solicitud)}</td>
                  <td className="py-2.5 pr-3">
                    {(() => {
                      const t = tiempoRestante(r.vence_en, ahora);
                      if (!t) return <span className="text-red-600 font-semibold">Plazo cumplido · se bloquea en breve</span>;
                      return (
                        <span className={`inline-flex items-center gap-1.5 font-semibold ${t.urgente ? 'text-red-600' : 'text-[#144193]'}`}>
                          <Clock size={14} /> Te faltan <CuentaRegresiva venceEn={r.vence_en} pequeno />
                          <span className="block font-normal text-xs text-slate-700 ml-1">hasta {fechaEC(r.vence_en)}</span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-2.5 pr-2 text-right">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => copiar(r.id, r.codigo)}>
                      {copiado === r.id ? <Check size={14} /> : <Copy size={14} />}
                      {copiado === r.id ? 'Copiado' : 'Copiar'}
                    </button>
                    <button
                      type="button"
                      className="btn-danger-outline btn-sm ml-2"
                      onClick={() => {
                        setPedir(r);
                        setMotivoPedido('');
                        setErrorPedido('');
                      }}
                    >
                      Pedir anulación
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {okPedido && (
        <p className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
          {okPedido}
        </p>
      )}

      <Modal
        open={!!pedir}
        onClose={() => setPedir(null)}
        title={`Pedir anulación del número ${pedir?.codigo ?? ''}`}
      >
        <p className="text-sm text-slate-900 mb-3">
          Esto no anula el número: le avisa al administrador y a la secretaria de tu sucursal, y queda
          registrado con tu motivo. Úsalo, por ejemplo, si la reunión no se hizo.
        </p>
        {errorPedido && (
          <div className="mb-3">
            <ErrorAlert message={errorPedido} />
          </div>
        )}
        <TextareaField
          label="Motivo"
          rows={3}
          value={motivoPedido}
          onChange={(e) => setMotivoPedido(e.target.value)}
          placeholder="Por qué pides anular este número"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-secondary" onClick={() => setPedir(null)}>
            Cancelar
          </button>
          <button type="button" className="btn-primary disabled:opacity-50" disabled={enviandoPedido} onClick={enviarPedido}>
            {enviandoPedido ? 'Enviando…' : 'Enviar pedido'}
          </button>
        </div>
      </Modal>

      <div className="mt-3">
        <button
          type="button"
          className="inline-flex items-center rounded-full border border-[#144193]/40 bg-[#F4F7FC] px-3.5 py-1.5 text-sm font-semibold text-[#144193] hover:bg-[#144193] hover:text-white transition-colors"
          onClick={() => setVerAnulados(!verAnulados)}
        >
          {verAnulados ? 'Ocultar' : 'Ver'} números de actas bloqueadas ({bloqueados.length})
        </button>
        {verAnulados && (
          <ul className="mt-3 space-y-2.5">
            {bloqueados.length === 0 && <li className="text-sm text-slate-900">No tienes actas bloqueadas.</li>}
            {bloqueados.map((b) => (
              <li key={b.id} className="flex flex-col gap-0.5 rounded-xl border border-red-200 bg-red-50/70 px-3.5 py-2.5">
                <span className="font-mono font-bold text-slate-900">{b.codigo}</span>
                <Ligado n={b} />
                <span className="text-xs text-red-800">
                  Bloqueada automáticamente por el sistema el {fechaEC(b.fecha_bloqueo)}: pasaron 48 horas sin completar la documentación.
                  Solo el administrador puede desbloquearla.
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Administrador ───────────────────────── */
function PanelAdmin({ version, onCambio }: { version: number; onCambio: () => void }) {
  const [datos, setDatos] = useState<{ pendientes: any[]; anulados: any[]; bloqueados: any[] } | null>(null);
  const [desbloq, setDesbloq] = useState<any | null>(null);
  const [desbloqueando, setDesbloqueando] = useState(false);
  const [msgDesbloq, setMsgDesbloq] = useState('');
  const [anular, setAnular] = useState<any | null>(null);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [verAnulados, setVerAnulados] = useState(false);
  const [reactivar, setReactivar] = useState<any | null>(null);
  const [reactivando, setReactivando] = useState(false);
  const [propios, setPropios] = useState<any[]>([]);
  const [copiado, setCopiado] = useState<number | null>(null);

  const confirmarReactivar = async () => {
    if (!reactivar) return;
    setReactivando(true);
    setError('');
    try {
      await reactivarNumeroActa(reactivar.id);
      setReactivar(null);
      onCambio();
    } catch (e: any) {
      setReactivar(null);
      setError(e?.response?.data?.detail || 'No se pudo reactivar el número');
    } finally {
      setReactivando(false);
    }
  };

  const confirmarDesbloqueo = async () => {
    if (!desbloq) return;
    setDesbloqueando(true);
    setError('');
    try {
      const r = await desbloquearActa(desbloq.id);
      setMsgDesbloq(
        r?.mismo_numero
          ? `Acta desbloqueada: el mediador recibió el número ${r.codigo} (nadie más lo había tomado).`
          : `Acta desbloqueada: el mediador recibió el número nuevo ${r?.codigo}. Debe rehacer y volver a firmar el acta con ese número.`
      );
      setDesbloq(null);
      onCambio();
    } catch (e: any) {
      setDesbloq(null);
      setError(e?.response?.data?.detail || 'No se pudo desbloquear el acta');
    } finally {
      setDesbloqueando(false);
    }
  };

  const cargar = () => {
    getNumerosActaAdmin().then(setDatos).catch(() => setDatos(null));
    // Los números propios que aún están dentro del plazo (no salen en la tabla de vencidos).
    getMiNumeroActa()
      .then((e: any) => setPropios((e?.reservados || []).filter((x: any) => !x.vencido)))
      .catch(() => setPropios([]));
  };

  const copiar = async (id: number, texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(id);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      /* si el navegador no deja copiar, el número sigue visible */
    }
  };

  useEffect(() => {
    cargar();
  }, [version]);

  const confirmar = async () => {
    if (!anular) return;
    if (motivo.trim().length < 5) {
      setError('Escribe el motivo de la anulación');
      return;
    }
    setError('');
    setGuardando(true);
    try {
      await anularNumeroActa(anular.id, motivo.trim());
      setAnular(null);
      setMotivo('');
      onCambio();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'No se pudo anular el número');
    } finally {
      setGuardando(false);
    }
  };

  if (!datos) return null;
  // Solo se listan los que ya pasaron el plazo de 48 horas; los que siguen
  // dentro del plazo no necesitan atención del administrador todavía.
  const pedidos = datos.pendientes.filter((n) => !!n.pedido_anulacion);
  const vencidos = datos.pendientes.filter((n) => (n.dias ?? 0) >= 2 && !n.pedido_anulacion);
  const codigosPropios = new Set(propios.map((x) => x.codigo));
  const enPlazo = datos.pendientes.filter((n) => (n.dias ?? 0) < 2 && !n.pedido_anulacion && !codigosPropios.has(n.codigo)).length;
  const bloqueados = datos.bloqueados || [];
  if (bloqueados.length === 0 && pedidos.length === 0 && vencidos.length === 0 && enPlazo === 0 && datos.anulados.length === 0 && propios.length === 0 && !msgDesbloq) return null;

  return (
    <div className="card px-5 py-4 mb-4 bg-white border border-[#C5D2E6] border-t-4 border-t-gold-400 shadow-[0_14px_30px_-22px_rgba(10,42,98,0.5)]">
      <div className="flex items-center gap-2 mb-2">
        <Hash size={18} className="text-gold-700" />
        <p className="font-semibold text-slate-900">
          Números de acta vencidos: pasaron 48 horas sin completar ({vencidos.length})
        </p>
      </div>

      {error && !anular && (
        <div className="mb-2">
          <ErrorAlert message={error} />
        </div>
      )}

      {msgDesbloq && (
        <div className="mb-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-900 flex items-start justify-between gap-3">
          <span>{msgDesbloq}</span>
          <button type="button" className="text-emerald-800 underline font-semibold shrink-0" onClick={() => setMsgDesbloq('')}>
            Cerrar
          </button>
        </div>
      )}

      {bloqueados.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-3.5 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-red-800 mb-2">
            <Lock size={16} /> Actas bloqueadas: pasaron 48 horas sin completar ({bloqueados.length})
          </p>
          <ul className="space-y-2">
            {bloqueados.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg bg-white border border-red-200 px-3 py-2.5">
                <span className="text-sm text-slate-900">
                  <span className="font-mono font-bold">{b.codigo}</span> · {b.mediador} · {b.ciudad} · {b.sucursal}
                  <span className="block text-xs text-slate-700">
                    <Ligado n={b} />
                    {' · '}Bloqueada el {fechaEC(b.fecha_bloqueo)}
                    {' · '}
                    {b.numero_libre ? 'Su número está libre para la sucursal' : 'Su número ya lo tomó otro mediador'}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => {
                    setError('');
                    setDesbloq(b);
                  }}
                >
                  Desbloquear
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pedidos.length > 0 && (
        <div className="mb-4 rounded-xl border border-gold-400 bg-gold-50 px-3.5 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-numa-900 mb-2">
            <Hash size={16} /> Pedidos de anulación de mediadores ({pedidos.length})
          </p>
          <ul className="space-y-2">
            {pedidos.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg bg-white border border-gold-300 px-3 py-2.5">
                <span className="text-sm text-slate-900">
                  <span className="font-mono font-bold">{n.codigo}</span> · {n.mediador} · {n.ciudad} · {n.sucursal}
                  <span className="block text-xs text-slate-700">
                    <Ligado n={n} />
                  </span>
                  <span className="block text-xs text-slate-800">Motivo: {n.pedido_anulacion}</span>
                </span>
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  onClick={() => {
                    setAnular(n);
                    setMotivo(n.pedido_anulacion || '');
                    setError('');
                  }}
                >
                  <Ban size={14} /> Anular
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {propios.length > 0 && (
        <div className="mb-3 rounded-xl border border-[#C5D2E6] bg-[#F4F7FC] px-3.5 py-2.5">
          <p className="text-xs font-semibold text-slate-800 mb-1.5">
            Tus números dentro del plazo de 48 horas ({propios.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {propios.map((r) => (
              <span key={r.id} className="inline-flex items-center gap-2 rounded-lg bg-white border border-[#C5D2E6] pl-2.5 pr-1 py-1">
                <span className="font-mono text-sm font-bold text-slate-900">{r.codigo}</span>
                <button type="button" className="btn-secondary btn-sm" onClick={() => copiar(r.id, r.codigo)}>
                  {copiado === r.id ? <Check size={14} /> : <Copy size={14} />}
                  {copiado === r.id ? 'Copiado' : 'Copiar'}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {enPlazo > 0 && (
        <p className="text-sm text-slate-700 mb-2">
          Hay {enPlazo} número{enPlazo === 1 ? '' : 's'} de otros mediadores dentro del plazo de 48 horas (no se muestran).
        </p>
      )}

      {vencidos.length === 0 ? (
        <p className="text-sm text-slate-900">Ningún mediador tiene un número vencido.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-900 bg-[#F4F7FC]">
                <th className="py-2 pl-3 pr-3 rounded-l-lg">Número</th>
                <th className="py-2 pr-3">Mediador</th>
                <th className="py-2 pr-3">Sucursal</th>
                <th className="py-2 pr-3">Pedido</th>
                <th className="py-2 pr-3">Días</th>
                <th className="py-2 rounded-r-lg" />
              </tr>
            </thead>
            <tbody>
              {vencidos.map((n) => (
                <tr key={n.id} className="border-t border-[#C5D2E6] odd:bg-white even:bg-[#F8FAFD]">
                  <td className="py-2.5 pl-3 pr-3 font-mono font-semibold">
                    {n.codigo}
                    {n.ligado_a && (
                      <span className="block font-sans text-xs font-normal text-slate-700">
                        {n.ligado_a === 'proceso' ? (
                          <>
                            Proceso{' '}
                            <a href={`/procesos/${n.proceso_id}`} className="underline font-semibold">
                              {n.proceso_codigo}
                            </a>
                          </>
                        ) : (
                          'Invitación rápida'
                        )}
                        {n.ligado_detalle ? ` · ${n.ligado_detalle}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">{n.mediador}</td>
                  <td className="py-2.5 pr-3">
                    {n.ciudad} · {n.sucursal}
                  </td>
                  <td className="py-2.5 pr-3">{fechaEC(n.fecha_solicitud)}</td>
                  <td className={`py-1.5 pr-3 ${(n.dias ?? 0) >= 2 ? 'text-red-600 font-semibold' : ''}`}>
                    {n.dias ?? 0}
                    {(n.dias ?? 0) >= 2 ? ' · vencidos' : ''}
                  </td>
                  <td className="py-2.5 pr-2 text-right">
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      onClick={() => {
                        setAnular(n);
                        setMotivo('');
                        setError('');
                      }}
                    >
                      <Ban size={14} /> Anular
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {datos.anulados.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            className="inline-flex items-center rounded-full border border-[#144193]/40 bg-[#F4F7FC] px-3.5 py-1.5 text-sm font-semibold text-[#144193] hover:bg-[#144193] hover:text-white transition-colors"
            onClick={() => setVerAnulados(!verAnulados)}
          >
            {verAnulados ? 'Ocultar' : 'Ver'} números de actas anuladas ({datos.anulados.length})
          </button>
          {verAnulados && (
            <ul className="mt-3 text-sm text-slate-900 space-y-2.5">
              {datos.anulados.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3.5 py-2.5">
                  <span>
                    <span className="font-mono">{n.codigo}</span> · {n.mediador} ·{' '}
                    {fechaEC(n.fecha_anulacion)} · {n.motivo_anulacion}
                  </span>
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={() => {
                      setError('');
                      setReactivar(n);
                    }}
                  >
                    Reactivar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!desbloq}
        onClose={() => setDesbloq(null)}
        onConfirm={confirmarDesbloqueo}
        loading={desbloqueando}
        confirmLabel="Sí, desbloquear"
        variante="primario"
        message={
          `¿Desbloquear el acta ${desbloq?.codigo ?? ''} de ${desbloq?.mediador ?? 'el mediador'}? Ese número quedó libre para otros mediadores: recibirá el número libre más bajo de la sucursal (puede ser el mismo si nadie lo tomó). Si el número cambia, deberá rehacer y volver a firmar el acta. Tendrá 48 horas nuevas.`
        }
      />

      <ConfirmDialog
        open={!!reactivar}
        onClose={() => setReactivar(null)}
        onConfirm={confirmarReactivar}
        loading={reactivando}
        confirmLabel="Sí, reactivar"
        variante="primario"
        message={`¿Reactivar el número ${reactivar?.codigo ?? ''}? Vuelve a ${reactivar?.mediador ?? 'el mediador'} como número pedido, con un plazo nuevo de 48 horas para completar esa acta.`}
      />

      <Modal
        open={!!anular}
        onClose={() => setAnular(null)}
        title={`Anular número ${anular?.codigo ?? ''}`}
      >
        <p className="text-sm text-slate-900 mb-3">
          {`El número queda libre para que lo tome ${anular?.mediador} u otro mediador de la sucursal. Si pasa un mes sin que nadie lo tome, queda anulado definitivamente.`}
        </p>
        {error && (
          <div className="mb-3">
            <ErrorAlert message={error} />
          </div>
        )}
        <TextareaField
          label="Motivo"
          rows={3}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Por qué se anula este número"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-secondary" onClick={() => setAnular(null)}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn-danger disabled:opacity-50"
            disabled={guardando}
            onClick={confirmar}
          >
            {guardando ? 'Anulando…' : 'Anular número'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
