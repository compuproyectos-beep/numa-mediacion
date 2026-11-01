'use client';

import { useState } from 'react';
import { Hash, Copy, Check } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui';
import { pedirNumeroActa } from '@/lib/services';

// Pide el número de acta de UNA invitación rápida, sin salir de la Agenda.
// El número queda ligado a la invitación: si ya lo tiene, se muestra ese
// (nunca se pide otro) y, al crear el proceso, pasa a él automáticamente.
export default function PedirNumeroActaBoton({
  citaId,
  numero,
  onPedido,
}: {
  citaId: number;
  numero?: { codigo?: string | null; estado?: string | null } | null;
  onPedido?: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);
  const [pedido, setPedido] = useState('');
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);

  const codigo = numero?.codigo || pedido;
  const anulado = numero?.estado === 'anulado';

  const pedir = async () => {
    setPidiendo(true);
    setError('');
    try {
      const r = await pedirNumeroActa(citaId);
      setPedido(r.codigo);
      onPedido?.();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'No se pudo pedir el número de acta');
    } finally {
      setPidiendo(false);
      setConfirmando(false);
    }
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* el número sigue visible aunque no se pueda copiar */
    }
  };

  if (codigo) {
    return (
      <div className="w-full rounded-md border border-numa-300 border-l-4 border-l-gold-500 bg-white px-4 py-3">
        <p className="text-sm font-semibold text-numa-900 flex items-center gap-2 flex-wrap">
          <Hash className="w-4 h-4 text-gold-600" aria-hidden="true" />
          Número de acta de esta invitación:
          <span className="font-mono text-base font-bold">{codigo}</span>
          {!anulado && (
            <button
              type="button"
              onClick={copiar}
              className="btn-secondary btn-sm"
            >
              {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiado ? 'Copiado' : 'Copiar'}
            </button>
          )}
        </p>
        {anulado ? (
          <p className="text-sm text-red-700 mt-1.5">
            Este número fue anulado y quedó libre. Pide uno nuevo para continuar con esta acta.
          </p>
        ) : (
          <ol className="text-sm text-numa-800 mt-1.5 list-decimal pl-5 space-y-0.5">
            <li>Redacta el acta con este número.</li>
            <li>Cuando la reunión continúe, pulsa «Crear el proceso»: el número pasa solo al proceso.</li>
            <li>Dentro del proceso, sube los documentos del acta.</li>
          </ol>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        disabled={pidiendo}
        className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
      >
        <Hash className="w-4 h-4" />
        Pedir número de acta
      </button>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      <ConfirmDialog
        open={confirmando}
        onClose={() => setConfirmando(false)}
        onConfirm={pedir}
        loading={pidiendo}
        confirmLabel="Pedir número"
        variante="primario"
        message="¿Pedir el número de acta de esta invitación? Quedará ligado a ella y tendrás 48 horas para completar el acta."
      />
    </div>
  );
}
