'use client';

import { useState } from 'react';
import { Hash, Copy, Check } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui';
import { pedirNumeroActa } from '@/lib/services';

// Botón para pedir el número de acta sin salir de la pantalla donde se está
// (por ejemplo, desde una invitación de la Agenda). Es el mismo número y las
// mismas reglas que en "Actas finales".
export default function PedirNumeroActaBoton() {
  const [confirmando, setConfirmando] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);

  const pedir = async () => {
    setPidiendo(true);
    setError('');
    try {
      const r = await pedirNumeroActa();
      setCodigo(r.codigo);
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

      {codigo && (
        <p className="mt-2 text-sm text-numa-700 flex items-center gap-2 flex-wrap">
          Tu número de acta: <span className="font-mono font-semibold">{codigo}</span>
          <button
            type="button"
            onClick={copiar}
            className="inline-flex items-center gap-1 text-xs text-gold-600 hover:text-gold-700"
          >
            {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <ConfirmDialog
        open={confirmando}
        onClose={() => setConfirmando(false)}
        onConfirm={pedir}
        loading={pidiendo}
        confirmLabel="Pedir número"
        message="¿Pedir un número de acta ahora?"
      />
    </div>
  );
}
