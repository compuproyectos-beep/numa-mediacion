import Link from 'next/link';
import { Home } from 'lucide-react';

// Botón fijo con una casita, arriba a la izquierda: lleva a la página
// principal desde cualquier pantalla pública (login, recuperar contraseña,
// sedes, aviso de privacidad) sin buscar el enlace de "volver".
// `soloAncho`: en las páginas que ya tienen el menú superior, solo se
// muestra en pantallas anchas para no taparlo.
export default function BotonInicio({ soloAncho = false }: { soloAncho?: boolean }) {
  return (
    <Link
      href="/"
      title="Ir a la página principal"
      aria-label="Ir a la página principal"
      className={`${soloAncho ? 'hidden xl:flex' : 'flex'} fixed left-4 top-4 z-[60] items-center justify-center w-11 h-11 rounded-full bg-gold-400 text-[#0A2A62] ring-2 ring-white/70 shadow-[0_12px_24px_-10px_rgba(3,12,35,0.7)] hover:bg-gold-300 hover:-translate-y-0.5 active:scale-95 transition`}
    >
      <Home className="w-5 h-5" strokeWidth={2.2} />
    </Link>
  );
}
