'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface Props {
  // Si se da "href" es un enlace; si no, un botón que ejecuta "onClick".
  href?: string;
  onClick?: () => void;
  children: ReactNode;
}

// Botón "Volver" que se coloca en la barra de arriba, a la izquierda de la campana
// (ver "barra-izquierda" en DashboardLayout). Así no ocupa una fila propia y el
// contenido de la pantalla sube. Si la barra no está disponible, queda arriba del contenido.
export default function BotonVolver({ href, onClick, children }: Props) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById('barra-izquierda'));
  }, []);

  const clase = 'btn-ghost text-sm -ml-2';
  const boton = href ? (
    <Link href={href} className={clase}>
      <ArrowLeft className="w-4 h-4" />
      {children}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={clase}>
      <ArrowLeft className="w-4 h-4" />
      {children}
    </button>
  );

  return slot ? createPortal(boton, slot) : <div className="mb-4">{boton}</div>;
}
