'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const CLAVE = 'sigm-tema';

// Botón para cambiar entre modo normal y modo oscuro. La elección se guarda
// en este navegador y se aplica antes de pintar la pantalla (ver layout.tsx).
export default function BotonModoOscuro({ className = '' }: { className?: string }) {
  const [oscuro, setOscuro] = useState(false);

  useEffect(() => {
    setOscuro(document.documentElement.classList.contains('dark'));
  }, []);

  const cambiar = () => {
    const siguiente = !oscuro;
    setOscuro(siguiente);
    document.documentElement.classList.toggle('dark', siguiente);
    try {
      localStorage.setItem(CLAVE, siguiente ? 'oscuro' : 'normal');
    } catch {
      /* sin almacenamiento: el cambio vale solo para esta visita */
    }
  };

  return (
    <button
      type="button"
      onClick={cambiar}
      title={oscuro ? 'Cambiar a modo normal' : 'Cambiar a modo oscuro'}
      aria-label={oscuro ? 'Cambiar a modo normal' : 'Cambiar a modo oscuro'}
      aria-pressed={oscuro}
      className={`w-10 h-10 rounded-full bg-white border border-numa-100 flex items-center justify-center hover:border-gold-400 transition-colors ${className}`}
    >
      {oscuro ? <Sun className="w-5 h-5 text-numa-700" /> : <Moon className="w-5 h-5 text-numa-700" />}
    </button>
  );
}
