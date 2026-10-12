'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Bell, Calendar, FileText, CheckCircle2 } from 'lucide-react';
import Sidebar from '@/components/layout/Sidebar';
import { getToken, getUser } from '@/lib/auth';
import {
  getNotificaciones,
  marcarNotificacionLeida,
  marcarTodasNotificacionesLeidas,
} from '@/lib/services';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [notificaciones, setNotificaciones] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    const token = getToken();

    if (!token) {
      router.replace('/login');
    } else {
      setHasToken(true);

      // Como el banco que te da un PIN inicial: si el admin te puso una
      // contraseña directamente (o el sistema generó una para el correo
      // de invitación), se obliga a cambiarla antes de usar el resto del
      // sistema, para que a partir de ahí solo esa persona la conozca.
      const usuarioActual = getUser();

      if (usuarioActual?.debe_cambiar_password && pathname !== '/cambiar-password') {
        router.replace('/cambiar-password');
      }
    }

    setCheckingAuth(false);
  }, [router, pathname]);

  const iconoPorTipo = (tipo: string) => {
    switch (tipo) {
      case 'recordatorio':
        // Las invitaciones de hoy/mañana llaman más la atención.
        return { Icon: Calendar, className: 'bg-amber-100 text-amber-700' };
      case 'cita':
        return { Icon: Calendar, className: 'bg-blue-50 text-blue-600' };
      case 'acta':
        return { Icon: FileText, className: 'bg-green-50 text-green-600' };
      case 'proceso':
        return { Icon: CheckCircle2, className: 'bg-gold-50 text-gold-600' };
      default:
        return { Icon: Bell, className: 'bg-numa-100 text-numa-600' };
    }
  };

  const cargarNotificaciones = async () => {
    try {
      const data = await getNotificaciones();
      setNotificaciones(data);
    } catch {
      setNotificaciones([]);
    }
  };

 useEffect(() => {
  if (!hasToken) return;

  cargarNotificaciones();

  // Refresca sola cada 2 minutos, ya que el layout no se vuelve a montar
  // al navegar entre pantallas (por diseño, para que la navegación sea
  // instantánea) y por eso no basta con cargarlas solo una vez al entrar.
  const intervalo = setInterval(cargarNotificaciones, 2 * 60 * 1000);

  return () => clearInterval(intervalo);
}, [hasToken]);

  useEffect(() => {
    if (!open) return;

    const cerrarSiEsAfuera = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', cerrarSiEsAfuera);

    return () => document.removeEventListener('mousedown', cerrarSiEsAfuera);
  }, [open]);

  if (checkingAuth || !hasToken) return null;

  const noLeidas = notificaciones.filter((n) => !n.leida).length;

  const abrirNotificacion = async (n: any) => {
    await marcarUna(n.id);

    // Solo las notificaciones ligadas a un proceso saben a dónde llevar;
    // las demás (o notificaciones viejas de antes de este cambio) solo se
    // marcan como leídas, sin navegar a ningún lado.
    if (n.referencia_tipo === 'proceso_mediacion' && n.referencia_id) {
      setOpen(false);
      router.push(`/procesos/${n.referencia_id}`);
    }
  };

  const marcarUna = async (id: number) => {
    await marcarNotificacionLeida(id);

    setNotificaciones((prev) =>
      prev.map((n) => (n.id === id ? { ...n, leida: true } : n))
    );
  };

  const marcarTodas = async () => {
    await marcarTodasNotificacionesLeidas();

    setNotificaciones((prev) =>
      prev.map((n) => ({ ...n, leida: true }))
    );
  };

  return (
    <div className="min-h-screen bg-numa-50 font-sans">
      <Sidebar />

      <main className="lg:pl-56 pt-14 lg:pt-0 min-h-screen">
        <div className="sticky top-0 z-20 bg-numa-50/90 backdrop-blur border-b border-numa-100">
          <div className="max-w-7xl mx-auto px-6 py-3 flex justify-end">
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => {
                  const abriendo = !open;
                  setOpen(abriendo);
                  if (abriendo) cargarNotificaciones();
                }}
                className="relative w-10 h-10 rounded-full bg-white border border-numa-100 flex items-center justify-center hover:border-gold-400 transition-colors"
              >
                <Bell className="w-5 h-5 text-numa-700" />

                {noLeidas > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                    {noLeidas}
                  </span>
                )}
              </button>

              {open && (
                <div className="absolute right-0 mt-3 w-[26rem] max-w-[calc(100vw-2rem)] bg-white border border-numa-100 rounded-md shadow-xl z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-numa-100 flex items-center justify-between">
                    <p className="font-semibold text-base text-numa-800">
                      Notificaciones
                    </p>

                    {noLeidas > 0 && (
                      <button
                        onClick={marcarTodas}
                        className="text-sm font-medium text-gold-700 hover:text-gold-800"
                      >
                        Marcar todas como leídas
                      </button>
                    )}
                  </div>

                  <div className="max-h-[28rem] overflow-y-auto">
                    {notificaciones.length === 0 ? (
                      <div className="px-4 py-8 text-sm text-numa-500 text-center">
                        Sin notificaciones
                      </div>
                    ) : (
                      notificaciones.map((n) => {
                        const { Icon, className } = iconoPorTipo(n.tipo);

                        return (
                          <button
                            key={n.id}
                            onClick={() => abrirNotificacion(n)}
                            className={`w-full text-left px-4 py-3.5 border-b border-numa-100 hover:bg-numa-50 transition flex gap-3 ${
                              !n.leida ? 'bg-gold-50/60' : ''
                            }`}
                          >
                            <div
                              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${className}`}
                            >
                              <Icon className="w-5 h-5" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="text-[15px] font-semibold text-numa-900 flex items-center gap-2">
                                {n.titulo}
                                {!n.leida && (
                                  <span
                                    className="w-2 h-2 rounded-full bg-gold-500 shrink-0"
                                    aria-label="No leída"
                                  />
                                )}
                              </p>

                              <p className="text-sm text-numa-600 mt-0.5 leading-snug break-words">
                                {n.mensaje}
                              </p>

                              <p className="text-xs text-numa-500 mt-1.5">
                                {new Date(n.fecha_creacion).toLocaleString('es-EC', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit'
                                })}
                              </p>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
