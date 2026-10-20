'use client';

import { useEffect, useState } from 'react';
import { X, UserPlus, FilePlus2, CalendarClock, FileCheck2 } from 'lucide-react';

const CLAVE_GUIA_VISTA = 'numa_guia_bienvenida_vista';

const pasos = [
  {
    icon: UserPlus,
    titulo: '1. Registra tus clientes',
    texto:
      'Antes de crear un proceso, registra al solicitante y al invitado en "Clientes" (nombre, cédula y contacto).'
  },
  {
    icon: FilePlus2,
    titulo: '2. Crea un proceso de mediación',
    texto:
      'En "Procesos" da clic en "Nuevo Proceso" y sigue los pasos: partes, tema y confirmación.'
  },
  {
    icon: CalendarClock,
    titulo: '3. Registra invitaciones y avances',
    texto:
      'Dentro de cada proceso puedes agendar invitaciones y dejar constancia de cada avance de la mediación.'
  },
  {
    icon: FileCheck2,
    titulo: '4. Sube la documentación',
    texto:
      'Cuando el proceso se cierre (con o sin acuerdo), sube la documentación y el comprobante de pago desde el mismo proceso.'
  }
];

interface GuiaBienvenidaProps {
  open: boolean;
  onClose: () => void;
}

export function GuiaBienvenida({ open, onClose }: GuiaBienvenidaProps) {
  if (!open) return null;

  return (
    <div className="card p-4 mb-3 border-2 border-gold-200 bg-gold-50/40 animate-fade-in relative">
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 text-numa-600 hover:text-numa-700"
        aria-label="Cerrar guía"
      >
        <X className="w-4 h-4" />
      </button>

      <h2 className="text-sm font-semibold text-numa-800 uppercase tracking-wider mb-0.5">
        Bienvenido a NUMA
      </h2>

      <p className="text-xs text-numa-600 mb-3">Así funciona el sistema, paso a paso:</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
        {pasos.map((p) => (
          <div key={p.titulo} className="flex gap-2.5">
            <div className="w-8 h-8 rounded-full bg-white border border-gold-200 flex items-center justify-center shrink-0">
              <p.icon className="w-4 h-4 text-gold-600" />
            </div>

            <div>
              <p className="text-sm font-semibold text-numa-800">{p.titulo}</p>
              <p className="text-xs text-numa-700 mt-0.5 leading-snug">{p.texto}</p>
            </div>
          </div>
        ))}
      </div>

      <button type="button" onClick={onClose} className="btn-primary btn-sm !py-1">
        Entendido
      </button>
    </div>
  );
}

// Hook que decide si la guía debe mostrarse automáticamente (primera vez
// que el usuario entra al panel) y expone funciones para cerrarla o para
// volver a abrirla manualmente desde el botón "¿Cómo funciona?".
export function useGuiaBienvenida() {
  const [mostrar, setMostrar] = useState(false);

  useEffect(() => {
    try {
      const vista = localStorage.getItem(CLAVE_GUIA_VISTA);
      if (!vista) setMostrar(true);
    } catch {
      // localStorage no disponible (modo privado, navegador restringido, etc.):
      // simplemente no se muestra automáticamente, para no romper la página.
    }
  }, []);

  const cerrarGuia = () => {
    setMostrar(false);

    try {
      localStorage.setItem(CLAVE_GUIA_VISTA, '1');
    } catch {
      // si no se puede guardar, la guía volverá a aparecer la próxima vez;
      // no es crítico.
    }
  };

  const abrirGuia = () => setMostrar(true);

  return { mostrar, cerrarGuia, abrirGuia };
}
