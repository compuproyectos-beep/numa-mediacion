'use client';

import { useState } from 'react';
import { Printer, Upload, Eye, Download, PauseCircle, PlayCircle, Pencil } from 'lucide-react';
import { Modal, ErrorAlert, TextareaField } from '@/components/ui';
import {
  subirActaFirmada,
  descargarActaFirmada,
  corregirAcuerdo,
  getHistorialAcuerdo,
  suspenderProceso,
  reactivarProceso
} from '@/lib/services';

interface Props {
  proceso: any;
  esAdmin: boolean;
  onCambio: () => void;
}

const fmt = (v?: string) => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// Todo lo que pasa DESPUÉS de cerrar con acuerdo: el acuerdo escrito, el acta
// imprimible, la subida del acta firmada, y (solo admin) corregir el acuerdo y
// suspender/reactivar el proceso.
export default function ActaFlujoProceso({ proceso, esAdmin, onCambio }: Props) {
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  // Acta firmada
  const [showFirmada, setShowFirmada] = useState(false);
  const [archivoFirmada, setArchivoFirmada] = useState<File | null>(null);
  const [confirmoFirmada, setConfirmoFirmada] = useState(false);
  const [subiendo, setSubiendo] = useState(false);

  // Corregir acuerdo (admin)
  const [showCorregir, setShowCorregir] = useState(false);
  const [textoNuevo, setTextoNuevo] = useState('');
  const [motivoCorreccion, setMotivoCorreccion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [historial, setHistorial] = useState<any[] | null>(null);

  // Suspender (admin)
  const [showSuspender, setShowSuspender] = useState(false);
  const [motivoSuspension, setMotivoSuspension] = useState('');

  if (proceso.estado !== 'cerrado_con_acuerdo') return null;

  const etapa = proceso.etapa_acta as string | null;
  const msg = (e: any, def: string) => e?.response?.data?.detail || def;

  const verFirmada = async () => {
    try {
      const blob = await descargarActaFirmada(proceso.id);
      window.open(window.URL.createObjectURL(blob), '_blank');
    } catch {
      setError('No se pudo abrir el acta firmada');
    }
  };

  const descargarFirmada = async () => {
    try {
      const blob = await descargarActaFirmada(proceso.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `acta_firmada_${proceso.codigo_proceso}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar el acta firmada');
    }
  };

  const subir = async () => {
    if (!archivoFirmada) return;
    setSubiendo(true);
    setError('');
    try {
      await subirActaFirmada(proceso.id, archivoFirmada);
      setShowFirmada(false);
      setArchivoFirmada(null);
      setConfirmoFirmada(false);
      setOk('Acta firmada subida. El proceso quedó completo.');
      onCambio();
    } catch (e: any) {
      setError(msg(e, 'No se pudo subir el acta firmada'));
    } finally {
      setSubiendo(false);
    }
  };

  const abrirCorregir = async () => {
    setTextoNuevo(proceso.acuerdo_texto || '');
    setMotivoCorreccion('');
    setError('');
    setShowCorregir(true);
    try {
      setHistorial(await getHistorialAcuerdo(proceso.id));
    } catch {
      setHistorial([]);
    }
  };

  const guardarCorreccion = async () => {
    setGuardando(true);
    setError('');
    try {
      await corregirAcuerdo(proceso.id, textoNuevo, motivoCorreccion);
      setShowCorregir(false);
      setOk('Acuerdo corregido. El acta imprimible ya usa el texto nuevo.');
      onCambio();
    } catch (e: any) {
      setError(msg(e, 'No se pudo corregir el acuerdo'));
    } finally {
      setGuardando(false);
    }
  };

  const suspender = async () => {
    setGuardando(true);
    setError('');
    try {
      await suspenderProceso(proceso.id, motivoSuspension);
      setShowSuspender(false);
      setMotivoSuspension('');
      setOk('Proceso suspendido. El mediador ya no queda bloqueado por este proceso.');
      onCambio();
    } catch (e: any) {
      setError(msg(e, 'No se pudo suspender'));
    } finally {
      setGuardando(false);
    }
  };

  const reactivar = async () => {
    setError('');
    try {
      await reactivarProceso(proceso.id);
      setOk('Proceso reactivado.');
      onCambio();
    } catch (e: any) {
      setError(msg(e, 'No se pudo reactivar'));
    }
  };

  const botonImprimir = (
    <button
      type="button"
      onClick={() => window.open(`/procesos/${proceso.id}/acta-imprimir`, '_blank')}
      className="btn-secondary text-xs"
    >
      <Printer className="w-3.5 h-3.5" /> Imprimir acta
    </button>
  );

  return (
    <div className="space-y-4">
      {error && !showFirmada && !showCorregir && !showSuspender && <ErrorAlert message={error} />}
      {ok && (
        <div className="text-sm px-4 py-3 rounded-sm border border-green-200 bg-green-50 text-green-700">
          {ok}
        </div>
      )}

      {/* Acuerdo registrado */}
      {proceso.acuerdo_texto && (
        <div className="card p-4">
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <h3 className="text-sm font-semibold text-numa-800">Acuerdo</h3>
            {esAdmin && (
              <button type="button" onClick={abrirCorregir} className="btn-ghost text-xs py-1 px-2">
                <Pencil className="w-3 h-3" /> Corregir acuerdo
              </button>
            )}
          </div>
          <p className="text-sm text-numa-700 whitespace-pre-line">{proceso.acuerdo_texto}</p>
        </div>
      )}

      {/* Suspendido */}
      {etapa === 'suspendido' && (
        <div className="card p-4 border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            <strong>Proceso suspendido por el administrador.</strong>{' '}
            {proceso.motivo_suspension ? `Motivo: ${proceso.motivo_suspension}. ` : ''}
            Ya no bloquea al mediador. Los documentos pendientes se podrán completar cuando el
            administrador lo reactive.
          </p>
          {esAdmin && (
            <button type="button" onClick={reactivar} className="btn-primary text-xs mt-3">
              <PlayCircle className="w-4 h-4" /> Reactivar proceso
            </button>
          )}
        </div>
      )}

      {/* Falta el acta firmada */}
      {etapa === 'falta_firmada' && (
        <div className="card p-4">
          <p className="text-sm text-numa-700 mb-1 font-semibold">Falta el acta firmada</p>
          <p className="text-sm text-numa-600 mb-3">
            Imprime el acta, haz que la firmen las partes y súbela en PDF (no se aceptan fotos).
            Mientras falte, no podrás subir las actas de tus otros procesos.
          </p>
          <div className="flex flex-wrap gap-2">
            {botonImprimir}
            <button
              type="button"
              onClick={() => {
                setShowFirmada(true);
                setArchivoFirmada(null);
                setConfirmoFirmada(false);
                setError('');
              }}
              className="btn-primary text-xs"
            >
              <Upload className="w-4 h-4" /> Subir acta firmada
            </button>
          </div>
        </div>
      )}

      {/* Completa */}
      {etapa === 'completa' && (
        <div className="card p-4 bg-green-50/40 border-green-100">
          <p className="text-sm text-green-800 font-semibold mb-1">Proceso completo</p>
          <p className="text-sm text-green-700 mb-3">
            {proceso.tiene_acta_firmada
              ? `El acta firmada se subió el ${fmt(proceso.acta_firmada_fecha)}.`
              : 'Proceso anterior a la regla del acta firmada.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {proceso.tiene_acta_firmada && (
              <button type="button" onClick={verFirmada} className="btn-secondary text-xs">
                <Eye className="w-3.5 h-3.5" /> Ver acta firmada
              </button>
            )}
            {esAdmin && proceso.tiene_acta_firmada && (
              <button
                type="button"
                onClick={descargarFirmada}
                title="Descargar acta firmada"
                aria-label="Descargar acta firmada"
                className="btn-ghost p-1.5"
              >
                <Download className="w-4 h-4" />
              </button>
            )}
            {botonImprimir}
          </div>
        </div>
      )}

      {/* Admin: suspender */}
      {esAdmin && (etapa === 'falta_acta' || etapa === 'falta_firmada') && (
        <div>
          <button
            type="button"
            onClick={() => {
              setShowSuspender(true);
              setError('');
            }}
            className="text-xs text-amber-700 hover:text-amber-800 underline underline-offset-2 inline-flex items-center gap-1"
          >
            <PauseCircle className="w-3.5 h-3.5" /> Suspender este proceso (desbloquear al mediador)
          </button>
        </div>
      )}

      {/* Modal: subir acta firmada */}
      <Modal
        open={showFirmada}
        onClose={() => setShowFirmada(false)}
        title={`Subir acta firmada — ${proceso.codigo_proceso}`}
      >
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-numa-700 mb-1">Acta firmada (PDF)</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setArchivoFirmada(e.target.files?.[0] || null)}
              className="input-field"
            />
          </div>
          <label className="flex items-start gap-2 text-sm text-numa-700">
            <input
              type="checkbox"
              checked={confirmoFirmada}
              onChange={(e) => setConfirmoFirmada(e.target.checked)}
              className="mt-1"
            />
            Confirmo que este documento es el acta firmada por todas las partes y por el mediador.
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowFirmada(false)} className="btn-secondary">
              Cancelar
            </button>
            <button
              type="button"
              onClick={subir}
              disabled={subiendo || !archivoFirmada || !confirmoFirmada}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {subiendo ? 'Subiendo...' : 'Subir acta firmada'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: corregir acuerdo (admin) */}
      <Modal
        open={showCorregir}
        onClose={() => setShowCorregir(false)}
        title={`Corregir acuerdo — ${proceso.codigo_proceso}`}
        size="lg"
      >
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="space-y-4">
          <TextareaField
            label="Texto del acuerdo"
            rows={6}
            value={textoNuevo}
            onChange={(e) => setTextoNuevo(e.target.value)}
          />
          <TextareaField
            label="Motivo de la corrección (queda registrado)"
            rows={2}
            value={motivoCorreccion}
            onChange={(e) => setMotivoCorreccion(e.target.value)}
          />

          {historial && historial.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-numa-500 uppercase tracking-wide mb-2">
                Correcciones anteriores
              </p>
              <ul className="space-y-2 max-h-40 overflow-y-auto">
                {historial.map((h) => (
                  <li key={h.id} className="text-xs text-numa-600 border border-numa-100 rounded-sm p-2">
                    <span className="font-medium">{h.usuario}</span> · {fmt(h.fecha)} — {h.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowCorregir(false)} className="btn-secondary">
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardarCorreccion}
              disabled={guardando || !textoNuevo.trim() || motivoCorreccion.trim().length < 5}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {guardando ? 'Guardando...' : 'Guardar corrección'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: suspender (admin) */}
      <Modal
        open={showSuspender}
        onClose={() => setShowSuspender(false)}
        title={`Suspender proceso — ${proceso.codigo_proceso}`}
      >
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="space-y-4">
          <p className="text-sm text-numa-600">
            El proceso no se borra: queda suspendido y el mediador puede subir las actas de sus
            otros procesos. Podrás reactivarlo más adelante para completar sus documentos.
          </p>
          <TextareaField
            label="Motivo (queda registrado)"
            rows={3}
            value={motivoSuspension}
            onChange={(e) => setMotivoSuspension(e.target.value)}
          />
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowSuspender(false)} className="btn-secondary">
              Cancelar
            </button>
            <button
              type="button"
              onClick={suspender}
              disabled={guardando || motivoSuspension.trim().length < 5}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {guardando ? 'Guardando...' : 'Suspender proceso'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
