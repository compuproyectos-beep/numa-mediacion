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
    titulo: '4. Sube el acta final',
    texto:
      'Cuando el proceso se cierre (con o sin acuerdo), sube el acta final y el comprobante de pago desde el mismo proceso.'
  }
];

interface GuiaBienvenidaProps {
  open: boolean;
  onClose: () => void;
}

export function GuiaBienvenida({ open, onClose }: GuiaBienvenidaProps) {
  if (!open) return null;

  return (
    <div className="card p-6 mb-6 border-2 border-gold-200 bg-gold-50/40 animate-fade-in relative">
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-numa-400 hover:text-numa-700"
        aria-label="Cerrar guía"
      >
        <X className="w-4 h-4" />
      </button>

      <h2 className="text-sm font-semibold text-numa-800 uppercase tracking-wider mb-1">
        Bienvenido a NUMA
      </h2>

      <p className="text-sm text-numa-600 mb-5">Así funciona el sistema, paso a paso:</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {pasos.map((p) => (
          <div key={p.titulo} className="flex gap-3">
            <div className="w-9 h-9 rounded-full bg-white border border-gold-200 flex items-center justify-center shrink-0">
              <p.icon className="w-4 h-4 text-gold-600" />
            </div>

            <div>
              <p className="text-sm font-semibold text-numa-800">{p.titulo}</p>
              <p className="text-xs text-numa-500 mt-1">{p.texto}</p>
            </div>
          </div>
        ))}
      </div>

      <button type="button" onClick={onClose} className="btn-primary btn-sm">
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
