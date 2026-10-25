'use client';

import { useEffect, useState } from 'react';
import { Hash, Copy, Check, Ban } from 'lucide-react';
import { ConfirmDialog, ErrorAlert, Modal, TextareaField } from '@/components/ui';
import {
  getMiNumeroActa,
  getNumerosActaAdmin,
  anularNumeroActa,
  reactivarNumeroActa
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

  return (
    <div className="card px-5 py-4 mb-4 bg-white border border-[#C5D2E6] border-t-4 border-t-gold-400 shadow-[0_14px_30px_-22px_rgba(10,42,98,0.5)]">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-gold-700">
          <Hash size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold text-slate-900">Mis números de acta</p>
          <p className="text-sm text-slate-800 mt-0.5">
            El número se asigna solo cuando cierras un proceso con acuerdo o con no acuerdo, o lo
            pides desde la Agenda en una invitación rápida. Tienes 48 horas para completar cada acta;
            pasado ese plazo, no podrás cerrar otros procesos con acta.
          </p>

          {estado.motivo && <p className="text-sm text-amber-700 mt-2">{estado.motivo}</p>}

          <p className="text-sm font-semibold text-slate-900 mt-3">
            Pendientes por completar ({reservados.length})
          </p>
          {reservados.length === 0 ? (
            <p className="text-sm text-slate-900 font-medium mt-1">No tienes números de acta pendientes.</p>
          ) : (
            <ul className="mt-2 space-y-2.5">
              {reservados.map((r) => (
                <li key={r.id} className={`flex flex-col gap-0.5 rounded-xl border px-3.5 py-2.5 ${r.vencido ? 'border-red-200 bg-red-50/60' : 'border-[#C5D2E6] bg-[#F4F7FC]'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-lg font-bold text-slate-900">{r.codigo}</span>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => copiar(r.id, r.codigo)}
                    >
                      {copiado === r.id ? <Check size={14} /> : <Copy size={14} />}
                      {copiado === r.id ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                  <Ligado n={r} />
                  <span className={`text-xs ${r.vencido ? 'text-red-600 font-semibold' : 'text-slate-900'}`}>
                    Asignado el {fechaEC(r.fecha_solicitud)}
                    {r.vencido
                      ? ' · ya pasaron 48 horas, completa esta acta'
                      : ` · plazo hasta ${fechaEC(r.vence_en)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3">
            <button
              type="button"
              className="inline-flex items-center rounded-full border border-[#144193]/40 bg-[#F4F7FC] px-3.5 py-1.5 text-sm font-semibold text-[#144193] hover:bg-[#144193] hover:text-white transition-colors"
              onClick={() => setVerAnulados(!verAnulados)}
            >
              {verAnulados ? 'Ocultar' : 'Ver'} números anulados por el administrador ({anulados.length})
            </button>
            {verAnulados && (
              <ul className="mt-3 space-y-2.5">
                {anulados.length === 0 && (
                  <li className="text-sm text-slate-900">No tienes números anulados.</li>
                )}
                {anulados.map((r) => (
                  <li key={r.id} className="flex flex-col gap-0.5 rounded-xl border border-rose-200 bg-rose-50/70 px-3.5 py-2.5">
                    <span className="font-mono font-bold text-slate-900">{r.codigo}</span>
                    <Ligado n={r} />
                    <span className="text-xs text-slate-900">
                      Anulado el {fechaEC(r.fecha_anulacion)}
                      {r.motivo_anulacion ? ` · Motivo: ${r.motivo_anulacion}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Administrador ───────────────────────── */
function PanelAdmin({ version, onCambio }: { version: number; onCambio: () => void }) {
  const [datos, setDatos] = useState<{ pendientes: any[]; anulados: any[] } | null>(null);
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
  const vencidos = datos.pendientes.filter((n) => (n.dias ?? 0) >= 2);
  const codigosPropios = new Set(propios.map((x) => x.codigo));
  const enPlazo = datos.pendientes.filter((n) => (n.dias ?? 0) < 2 && !codigosPropios.has(n.codigo)).length;
  if (vencidos.length === 0 && enPlazo === 0 && datos.anulados.length === 0 && propios.length === 0) return null;

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
                    {(n.dias ?? 0) >= 2 ? ' · vencido' : ''}
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
            {verAnulados ? 'Ocultar' : 'Ver'} números anulados ({datos.anulados.length})
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
                    className="btn-sm inline-flex items-center gap-1.5 rounded-lg bg-[#144193] px-3 py-1.5 font-bold text-white shadow-[0_8px_16px_-10px_rgba(10,42,98,0.9)] hover:bg-[#1B4AAE] active:scale-[0.98] transition"
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
        open={!!reactivar}
        onClose={() => setReactivar(null)}
        onConfirm={confirmarReactivar}
        loading={reactivando}
        confirmLabel="Sí, reactivar"
        message={`¿Reactivar el número ${reactivar?.codigo ?? ''}? Vuelve a ${reactivar?.mediador ?? 'el mediador'} como número pedido, con un plazo nuevo de 48 horas para completar esa acta.`}
      />

      <Modal
        open={!!anular}
        onClose={() => setAnular(null)}
        title={`Anular número ${anular?.codigo ?? ''}`}
      >
        <p className="text-sm text-slate-900 mb-3">
          {anular?.cita_id || anular?.proceso_id
            ? `El número está ligado a ${anular?.proceso_id ? 'un proceso' : 'una invitación'}: ${anular?.mediador} no podrá pedir otro para esa acta. Más adelante puedes reactivarlo para que continúe con el mismo número.`
            : `El número queda anulado y no se vuelve a entregar. ${anular?.mediador} podrá pedir otro.`}
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
