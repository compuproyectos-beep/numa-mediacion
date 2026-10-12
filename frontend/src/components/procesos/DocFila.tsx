'use client';

import { Eye, Download } from 'lucide-react';

interface Props {
  etiqueta: string;
  onVer?: () => void;
  onDescargar?: () => void;
  // Texto gris cuando el documento todavía no existe (ej. "Pendiente").
  pendiente?: string;
}

// Una fila de documento: nombre + íconos (ver / descargar), sin texto en los botones.
export default function DocFila({ etiqueta, onVer, onDescargar, pendiente }: Props) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-numa-700 min-w-[170px]">{etiqueta}</span>
      {pendiente ? (
        <span className="text-xs text-amber-600">{pendiente}</span>
      ) : (
        <>
          {onVer && (
            <button
              type="button"
              onClick={onVer}
              title="Ver"
              aria-label={`Ver ${etiqueta}`}
              className="btn-ghost p-1.5"
            >
              <Eye className="w-4 h-4" />
            </button>
          )}
          {onDescargar && (
            <button
              type="button"
              onClick={onDescargar}
              title="Descargar"
              aria-label={`Descargar ${etiqueta}`}
              className="btn-ghost p-1.5"
            >
              <Download className="w-4 h-4" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
