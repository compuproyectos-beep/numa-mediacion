'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { getActasAtrasadas } from '@/lib/services';

// Aviso solo para el administrador: procesos con acuerdo que llevan más de 5
// días sin completar el acta (acta + comprobante + acta firmada).
export default function AlertaActasAtrasadas() {
  const router = useRouter();
  const [lista, setLista] = useState<any[]>([]);

  useEffect(() => {
    getActasAtrasadas().then(setLista).catch(() => setLista([]));
  }, []);

  if (lista.length === 0) return null;

  return (
    <div className="px-4 py-3 rounded-sm border border-red-200 bg-red-50 text-sm text-red-800">
      <p className="font-semibold flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4" />
        {lista.length === 1
          ? '1 proceso lleva más de 5 días sin completar su acta'
          : `${lista.length} procesos llevan más de 5 días sin completar su acta`}
      </p>
      <ul className="space-y-1">
        {lista.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-2">
            <button
              type="button"
              onClick={() => router.push(`/procesos/${p.id}`)}
              className="underline underline-offset-2 font-medium"
            >
              {p.codigo_proceso}
            </button>
            <span>
              · {p.mediador} ({p.sucursal}) · {p.dias} días · {p.etapa}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
