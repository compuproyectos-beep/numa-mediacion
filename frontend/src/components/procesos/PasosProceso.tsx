'use client';

import { Check, ArrowRightCircle } from 'lucide-react';

export interface PasoProceso {
  etiqueta: string;
  hecho: boolean;
}

interface Props {
  pasos: PasoProceso[] | null;
  // Qué le toca hacer ahora (el antiguo aviso "Siguiente paso").
  mensaje?: string | null;
}

// Un solo bloque arriba del proceso: la línea de pasos (qué ya se hizo, en
// cuál está y cuáles faltan) y, debajo, la indicación de qué hacer ahora.
// El primer paso sin hacer es el "actual".
export default function PasosProceso({ pasos, mensaje }: Props) {
  if (!pasos && !mensaje) return null;

  const actual = pasos ? pasos.findIndex((p) => !p.hecho) : -1;

  return (
    <div className="mb-4 rounded-md border border-numa-200 bg-white overflow-hidden">
      {pasos && (
        <ol className="flex items-start px-3 pt-4 pb-3" aria-label="Pasos del proceso">
          {pasos.map((p, i) => {
            const esActual = i === actual;
            const ultimo = i === pasos.length - 1;

            return (
              <li
                key={p.etiqueta}
                className="relative flex-1 flex flex-col items-center text-center min-w-0"
                aria-current={esActual ? 'step' : undefined}
              >
                {!ultimo && (
                  <span
                    aria-hidden="true"
                    className={`absolute top-[11px] left-1/2 w-full h-0.5 ${
                      p.hecho ? 'bg-emerald-400' : 'bg-slate-200'
                    }`}
                  />
                )}

                <span
                  className={`relative z-10 flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold border-2 ${
                    p.hecho
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : esActual
                      ? 'bg-gold-400 border-gold-400 text-numa-900 ring-4 ring-gold-400/25'
                      : 'bg-white border-slate-300 text-slate-600'
                  }`}
                >
                  {p.hecho ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : i + 1}
                </span>

                <span
                  className={`mt-1.5 px-1 text-[11px] leading-tight ${
                    esActual
                      ? 'font-semibold text-numa-900'
                      : p.hecho
                      ? 'text-numa-700'
                      : 'text-slate-600'
                  }`}
                >
                  {p.etiqueta}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {mensaje && (
        <div
          className={`flex items-start gap-2.5 px-4 py-2.5 text-sm text-numa-800 bg-gold-400/10 ${
            pasos ? 'border-t border-gold-400/30' : ''
          }`}
        >
          <ArrowRightCircle className="w-4 h-4 mt-0.5 text-gold-600 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold text-numa-900">Siguiente paso: </span>
            {mensaje}
          </span>
        </div>
      )}
    </div>
  );
}
