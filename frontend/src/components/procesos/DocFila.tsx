'use client';

import { Eye, Download } from 'lucide-react';

interface Props {
  etiqueta: string;
  textoVer?: string;
  onVer?: () => void;
  // Solo se pasa para el administrador; el mediador solo puede ver.
  onDescargar?: () => void;
}

// Una fila de documento: nombre + botón "Ver ..." (+ ícono descargar solo admin).
export default function DocFila({ etiqueta, textoVer = 'Ver', onVer, onDescargar }: Props) {
  return (
    <div className="flex items-center gap-2 text-sm py-2.5">
      <span className="text-numa-800 min-w-[170px]">{etiqueta}</span>
      {onVer && (
        <button type="button" onClick={onVer} className="btn-primary btn-sm">
          <Eye className="w-4 h-4" /> {textoVer}
        </button>
      )}
      {onDescargar && (
        <button
          type="button"
          onClick={onDescargar}
          title="Descargar"
          aria-label={`Descargar ${etiqueta}`}
          className="btn-icon"
        >
          <Download className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
