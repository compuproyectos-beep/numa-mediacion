'use client';

import { useState } from 'react';
import { ErrorAlert, Modal, TextareaField } from '@/components/ui';
import { pedirAnulacionNumeroActa } from '@/lib/services';

// Botón para que el mediador pida al administrador que anule su número de acta (por ejemplo,
// si la reunión no se hizo). No anula nada: avisa al administrador y a la secretaria de la
// sucursal, y queda registrado con el motivo en la auditoría.
export default function PedirAnulacionBoton({ numeroId, codigo }: { numeroId: number; codigo: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [enviado, setEnviado] = useState(false);

  const enviar = async () => {
    if (motivo.trim().length < 5) {
      setError('Escribe el motivo del pedido');
      return;
    }
    setEnviando(true);
    setError('');
    try {
      await pedirAnulacionNumeroActa(numeroId, motivo.trim());
      setAbierto(false);
      setMotivo('');
      setEnviado(true);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'No se pudo enviar el pedido');
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <span className="text-sm font-medium text-emerald-800">
        Pedido enviado y registrado.
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn-danger-outline btn-sm"
        onClick={() => {
          setAbierto(true);
          setError('');
        }}
      >
        Pedir anulación
      </button>
      <Modal open={abierto} onClose={() => setAbierto(false)} title={`Pedir anulación del número ${codigo}`}>
        <p className="text-sm text-slate-900 mb-3">
          Esto no anula el número: le avisa al administrador y a la secretaria de tu sucursal, y queda
          registrado con tu motivo. Úsalo, por ejemplo, si la reunión no se hizo.
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
          placeholder="Por qué pides anular este número"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-secondary" onClick={() => setAbierto(false)}>
            Cancelar
          </button>
          <button type="button" className="btn-primary disabled:opacity-50" disabled={enviando} onClick={enviar}>
            {enviando ? 'Enviando…' : 'Enviar pedido'}
          </button>
        </div>
      </Modal>
    </>
  );
}
