'use client';

import { useEffect, useState } from 'react';
import { Hash, Copy, Check, Ban } from 'lucide-react';
import { ConfirmDialog, ErrorAlert, Modal, TextareaField } from '@/components/ui';
import {
  getMiNumeroActa,
  pedirNumeroActa,
  getNumerosActaAdmin,
  anularNumeroActa
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
      <PanelMediador version={version} onCambio={refrescar} />
      {esAdmin && <PanelAdmin version={version} onCambio={refrescar} />}
    </>
  );
}

/* ───────────────────────── Mediador ───────────────────────── */
function PanelMediador({ version, onCambio }: { version: number; onCambio: () => void }) {
  const [estado, setEstado] = useState<any | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState<number | null>(null);

  const cargar = () =>
    getMiNumeroActa().then(setEstado).catch(() => setEstado(null));

  useEffect(() => {
    cargar();
  }, [version]);

  const pedir = async () => {
    setError('');
    setPidiendo(true);
    try {
      await pedirNumeroActa();
      setConfirmando(false);
      onCambio();
    } catch (e: any) {
      setConfirmando(false);
      setError(e?.response?.data?.detail || 'No se pudo pedir el número de acta');
    } finally {
      setPidiendo(false);
    }
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

  if (!estado) return null;

  const reservados: any[] = estado.reservados || [];

  return (
    <div className="card px-4 py-3 mb-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-gold-600">
          <Hash size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-numa-900">Número de acta</p>
          <p className="text-sm text-slate-600 mt-0.5">
            Pídelo antes de redactar tu acta. Tienes 48 horas para completarla; pasado ese plazo,
            no podrás pedir otro número ni subir otras actas.
          </p>

          {error && (
            <div className="my-2">
              <ErrorAlert message={error} />
            </div>
          )}

          {reservados.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {reservados.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-bold text-numa-900">{r.codigo}</span>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => copiar(r.id, r.codigo)}
                  >
                    {copiado === r.id ? <Check size={14} /> : <Copy size={14} />}
                    {copiado === r.id ? 'Copiado' : 'Copiar'}
                  </button>
                  <span className={`text-xs ${r.vencido ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                    Pedido el {fechaEC(r.fecha_solicitud)}
                    {r.vencido ? ' · ya pasaron 48 horas, completa esta acta' : ` · plazo hasta ${fechaEC(r.vence_en)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {estado.motivo && <p className="text-sm text-amber-700 mt-2">{estado.motivo}</p>}

          <button
            type="button"
            className="btn-primary btn-sm mt-2 disabled:opacity-50"
            disabled={!estado.puede_pedir || pidiendo}
            onClick={() => {
              setError('');
              setConfirmando(true);
            }}
          >
            Pedir número de acta
          </button>

          {estado.recientes?.length > 0 && (
            <p className="text-xs text-slate-500 mt-2">
              Números anulados por el administrador:{' '}
              {estado.recientes.map((r: any) => r.codigo).join(', ')}
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmando}
        onClose={() => setConfirmando(false)}
        onConfirm={pedir}
        loading={pidiendo}
        confirmLabel="Sí, pedir número"
        message="¿Quieres pedir un número de acta? Se te asignará el siguiente número consecutivo de tu sucursal y tendrás 48 horas para completar esa acta. Una vez pedido, solo el administrador puede anularlo."
      />
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

  const cargar = () =>
    getNumerosActaAdmin().then(setDatos).catch(() => setDatos(null));

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
  if (datos.pendientes.length === 0 && datos.anulados.length === 0) return null;

  return (
    <div className="card px-4 py-3 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <Hash size={18} className="text-gold-600" />
        <p className="font-semibold text-numa-900">
          Números de acta pedidos sin completar ({datos.pendientes.length})
        </p>
      </div>

      {datos.pendientes.length === 0 ? (
        <p className="text-sm text-slate-500">Ningún mediador tiene un número pendiente.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-3">Número</th>
                <th className="py-1 pr-3">Mediador</th>
                <th className="py-1 pr-3">Sucursal</th>
                <th className="py-1 pr-3">Pedido</th>
                <th className="py-1 pr-3">Días</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {datos.pendientes.map((n) => (
                <tr key={n.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3 font-mono font-semibold">{n.codigo}</td>
                  <td className="py-1.5 pr-3">{n.mediador}</td>
                  <td className="py-1.5 pr-3">
                    {n.ciudad} · {n.sucursal}
                  </td>
                  <td className="py-1.5 pr-3">{fechaEC(n.fecha_solicitud)}</td>
                  <td className="py-1.5 pr-3">{n.dias ?? 0}</td>
                  <td className="py-1.5 text-right">
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
            className="text-xs text-slate-500 underline"
            onClick={() => setVerAnulados(!verAnulados)}
          >
            {verAnulados ? 'Ocultar' : 'Ver'} números anulados ({datos.anulados.length})
          </button>
          {verAnulados && (
            <ul className="mt-1 text-sm text-slate-600 space-y-0.5">
              {datos.anulados.map((n) => (
                <li key={n.id}>
                  <span className="font-mono">{n.codigo}</span> · {n.mediador} ·{' '}
                  {fechaEC(n.fecha_anulacion)} · {n.motivo_anulacion}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Modal
        open={!!anular}
        onClose={() => setAnular(null)}
        title={`Anular número ${anular?.codigo ?? ''}`}
      >
        <p className="text-sm text-slate-600 mb-3">
          El número queda anulado y no se vuelve a entregar. {anular?.mediador} podrá pedir otro.
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
