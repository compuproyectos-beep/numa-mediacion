'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Bell, Calendar, FileText, CheckCircle2, AlertTriangle, Clock, X } from 'lucide-react';
import { Modal } from '@/components/ui';
import Sidebar from '@/components/layout/Sidebar';
import BotonModoOscuro from '@/components/layout/BotonModoOscuro';
import { CuentaRegresiva } from '@/components/actas/NumeroActaPanel';
import { getToken, getUser } from '@/lib/auth';
import {
  getNotificaciones,
  getTotalNoLeidas,
  getNotificacionesUrgentes,
  marcarNotificacionLeida,
  marcarTodasNotificacionesLeidas,
} from '@/lib/services';

// Cómo se avisa cada notificación (se decide por su título):
//  - urgente: banner fijo arriba hasta que la persona lo cierra o lo abre.
//  - destacada: tarjeta emergente unos segundos cuando llega.
//  - el resto: solo queda en la campana.
const TITULOS_URGENTES = new Set([
  'Proceso suspendido',
  'Número de acta anulado',
  'Número de acta sin completar',
  'Acta con plazo vencido',
  'Acta bloqueada',
  'Acta bloqueada por plazo',
  'Acta por vencer',
  'Cuenta bloqueada',
]);
const TITULOS_DESTACADOS = new Set([
  'Nueva invitación asignada',
  'Nueva invitación creada',
  'Nueva invitación rápida',
  'Invitación cancelada',
  'Acta de no acuerdo pedida',
  'Proceso reactivado',
  'Número de acta reactivado',
  'Acta desbloqueada',
]);
const esUrgente = (n: any) => TITULOS_URGENTES.has(n?.titulo);
const esDestacada = (n: any) => TITULOS_DESTACADOS.has(n?.titulo);

const fechaNotificacion = (v: any) =>
  new Date(v).toLocaleString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [notificaciones, setNotificaciones] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [hasToken, setHasToken] = useState(false);
  // Notificación abierta en la ventana de detalle, avisos emergentes en
  // pantalla y los ids ya vistos (para avisar solo lo que llega nuevo).
  // Ventana de detalle: puede traer varias notificaciones (las del banner rojo)
  // para pasarlas con "Anterior / Siguiente" sin cerrar y abrir cada una.
  const [detalleLista, setDetalleLista] = useState<any[]>([]);
  const [detalleIdx, setDetalleIdx] = useState(0);
  const detalle = detalleLista[detalleIdx] ?? null;
  const setDetalle = (n: any | null) => {
    setDetalleLista(n ? [n] : []);
    setDetalleIdx(0);
  };
  // Avisos urgentes vigentes (los pide el servidor: no se quitan por abrirlos).
  const [urgentesServidor, setUrgentesServidor] = useState<any[] | null>(null);
  // Total real de sin leer (la lista trae solo las 50 más recientes).
  const [totalNoLeidas, setTotalNoLeidas] = useState<number | null>(null);
  const [avisos, setAvisos] = useState<any[]>([]);
  const idsVistos = useRef<Set<number> | null>(null);
  const tituloBase = useRef<string>('');

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
      } else if (
        usuarioActual?.rol === 'secretaria' &&
        !['/agenda', '/clientes', '/reportes', '/cambiar-password'].some(
          (r) => pathname === r || pathname.startsWith(r + '/')
        )
      ) {
        // La secretaria solo usa la Agenda y los Clientes.
        router.replace('/agenda');
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
      case 'reunion':
        return { Icon: Calendar, className: 'bg-purple-50 text-purple-700' };
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
      getTotalNoLeidas().then(setTotalNoLeidas).catch(() => {});
      getNotificacionesUrgentes().then(setUrgentesServidor).catch(() => setUrgentesServidor(null));

      // Lo que llega nuevo y es "destacado" sale como tarjeta emergente. La
      // primera carga solo registra lo que ya existía, sin avisar.
      if (idsVistos.current === null) {
        idsVistos.current = new Set(data.map((n: any) => n.id));
      } else {
        const vistos = idsVistos.current;
        const nuevas = data.filter((n: any) => !vistos.has(n.id));
        nuevas.forEach((n: any) => vistos.add(n.id));
        const aMostrar = nuevas.filter((n: any) => !n.leida && esDestacada(n)).slice(0, 3);
        if (aMostrar.length > 0) {
          setAvisos((prev) => [...prev, ...aMostrar].slice(-3));
          aMostrar.forEach((n: any) => {
            setTimeout(() => setAvisos((prev) => prev.filter((x) => x.id !== n.id)), 30000);
          });
        }
      }
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

  // Al volver a esta pestaña se revisa de inmediato, sin esperar los 2 minutos.
  const alVolver = () => {
    if (document.visibilityState === 'visible') cargarNotificaciones();
  };
  document.addEventListener('visibilitychange', alVolver);
  window.addEventListener('focus', alVolver);

  return () => {
    clearInterval(intervalo);
    document.removeEventListener('visibilitychange', alVolver);
    window.removeEventListener('focus', alVolver);
  };
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

  // Número de notificaciones sin leer en el título de la pestaña: "(3) SIGM".
  const sinLeerLista = notificaciones.filter((n) => !n.leida).length;
  const sinLeerTitulo = Math.max(totalNoLeidas ?? 0, sinLeerLista);
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const poner = () => {
      const actual = document.title.replace(/^\(\d+\)\s*/, '');
      if (actual) tituloBase.current = actual;
      const deseado = sinLeerTitulo > 0 ? `(${sinLeerTitulo}) ${tituloBase.current}` : tituloBase.current;
      if (document.title !== deseado) document.title = deseado;
    };
    poner();

    // Next.js vuelve a escribir el título al cambiar de dirección (por ejemplo
    // al abrir otra invitación en la Agenda) y borraba el número: se vuelve a poner.
    const el = document.querySelector('title');
    const observador = el ? new MutationObserver(poner) : null;
    if (el && observador) observador.observe(el, { childList: true, characterData: true, subtree: true });
    return () => observador?.disconnect();
  }, [sinLeerTitulo, pathname]);

  if (checkingAuth || !hasToken) return null;

  const noLeidas = sinLeerTitulo;
  // Los "persistentes" (acta sin completar, vencida o bloqueada) siguen
  // en el banner hasta que se resuelve el problema; el resto, hasta que se lee.
  // Mientras el servidor no responde no se muestra ningún aviso (salvo "Cuenta bloqueada"):
  // la lista local puede traer avisos ya resueltos que aparecerían un instante y luego
  // desaparecerían.
  const urgentesTodos =
    urgentesServidor ?? notificaciones.filter((n) => !n.leida && n?.titulo === 'Cuenta bloqueada');
  // El banner rojo solo se muestra donde le sirve a la persona, para no estorbar en
  // todo el sistema (en la campana siempre se pueden ver). "Cuenta bloqueada" es de
  // seguridad y sale en todas las pantallas.
  const rolActual = getUser()?.rol;
  const rutasBanner =
    rolActual === 'administrador'
      ? ['/dashboard', '/actas-finales']
      : ['/dashboard', '/procesos', '/actas-finales', '/agenda'];
  const enRutaBanner = rutasBanner.some((r) => pathname === r || pathname.startsWith(r + '/'));
  const urgentes = urgentesTodos.filter((n) => n.titulo === 'Cuenta bloqueada' || enRutaBanner);
  const esPersistente = (n: any) =>
    ['Número de acta sin completar', 'Acta con plazo vencido', 'Acta bloqueada', 'Acta bloqueada por plazo', 'Acta por vencer'].includes(n?.titulo);

  // Abre la ventana con todos los avisos urgentes, empezando por el primero.
  const abrirUrgentes = () => {
    setOpen(false);
    setDetalleLista(urgentes);
    setDetalleIdx(0);
    urgentes.slice(0, 1).forEach((n) => { if (!n.leida) marcarUna(n.id); });
  };
  const irA = (i: number) => {
    const n = detalleLista[i];
    setDetalleIdx(i);
    if (n && !n.leida) marcarUna(n.id);
  };

  // Al tocar una notificación se abre su detalle (y queda leída); desde ahí
  // la persona decide si va al proceso o a la agenda.
  const abrirNotificacion = async (n: any) => {
    setOpen(false);
    setAvisos((prev) => prev.filter((x) => x.id !== n.id));
    setDetalle(n);
    if (!n.leida) await marcarUna(n.id);
  };

  const destinoDe = (n: any): { texto: string; ruta: string } | null => {
    // La secretaria solo entra a Agenda y Clientes: a lo demás no la llevamos
    // (la pantalla la regresaría a la Agenda sin explicación).
    const esSecretariaActual = getUser()?.rol === 'secretaria';
    if (!esSecretariaActual && n?.proceso_destino) {
      return { texto: 'Ir al proceso', ruta: `/procesos/${n.proceso_destino}` };
    }
    if (!esSecretariaActual && n?.referencia_tipo === 'proceso_mediacion' && n.referencia_id) {
      return { texto: 'Ir al proceso', ruta: `/procesos/${n.referencia_id}` };
    }
    if (n?.referencia_tipo === 'cita' && n.referencia_id) {
      return { texto: 'Ir a la agenda', ruta: `/agenda?cita=${n.referencia_id}${n.cita_usuario_id ? `&mediador=${n.cita_usuario_id}` : ''}` };
    }
    if (!esSecretariaActual && (n?.referencia_tipo === 'numero_acta' || n?.referencia_tipo === 'bloqueo_acta')) {
      return { texto: 'Ir a Actas finales', ruta: '/actas-finales' };
    }
    return null;
  };

  const marcarUna = async (id: number) => {
    // Los avisos calculados por el servidor (id negativo, como "Acta por vencer") no se marcan como leídos.
    if (id < 0) return;
    const yaLeida = notificaciones.find((n) => n.id === id)?.leida;
    await marcarNotificacionLeida(id);
    if (!yaLeida) setTotalNoLeidas((t) => (t === null ? t : Math.max(0, t - 1)));

    setNotificaciones((prev) =>
      prev.map((n) => (n.id === id ? { ...n, leida: true } : n))
    );
    // Un urgente "normal" sale del banner al leerlo; los persistentes se quedan.
    setUrgentesServidor((prev) =>
      prev ? prev.filter((x) => x.id !== id || ['Número de acta sin completar', 'Acta con plazo vencido', 'Acta bloqueada', 'Acta bloqueada por plazo', 'Acta por vencer'].includes(x.titulo)) : prev
    );
  };

  const marcarTodas = async () => {
    await marcarTodasNotificacionesLeidas();
    setTotalNoLeidas(0);

    setNotificaciones((prev) =>
      prev.map((n) => ({ ...n, leida: true }))
    );
  };

  return (
    <div className="min-h-screen bg-[#E8EEF6] font-sans">
      <Sidebar />

      <main className="menu-pad pt-14 lg:pt-0 min-h-screen">
        <div className="sticky top-0 z-20 bg-[#E8EEF6]/90 backdrop-blur border-b border-numa-100">
          <div className="max-w-7xl mx-auto px-6 py-1.5 flex items-center justify-between gap-3">
            {/* Espacio a la izquierda de la campana: algunas pantallas (como el detalle de un proceso) ponen aquí su botón "Volver". */}
            <div id="barra-izquierda" className="flex items-center min-w-0" />
            <div className="relative" ref={dropdownRef}>
              <BotonModoOscuro className="absolute right-12 top-0 mr-2" />
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
                      <div className="px-4 py-8 text-sm text-numa-700 text-center">
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

                              <p className="text-xs text-numa-700 mt-1.5">
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

          {urgentes.length > 0 && (
            <div className="bg-[#F4F7FC] border-t border-[#DCE5F3]" role="alert">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5">
                <div className={`relative flex flex-wrap items-center gap-x-4 gap-y-2 overflow-hidden rounded-xl border pl-4 pr-3 py-2.5 shadow-[0_8px_20px_-16px_rgba(11,39,89,0.7)] ${
                  urgentes[0].titulo === 'Acta por vencer'
                    ? 'border-red-300 bg-gradient-to-r from-red-50 via-red-50 to-white'
                    : 'border-[#CBD6E8] bg-white'
                }`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    urgentes[0].titulo === 'Acta por vencer' ? 'bg-red-700 text-white' : 'bg-[#FDECEC] text-[#C0262D]'
                  }`}>
                    {urgentes[0].titulo === 'Acta por vencer'
                      ? <Clock className="w-[18px] h-[18px]" aria-hidden="true" />
                      : <AlertTriangle className="w-[18px] h-[18px]" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#0A2A62] leading-tight">
                      {urgentes[0].titulo}
                      {urgentes.length > 1 && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-[#FDECEC] px-2 py-0.5 align-middle text-[11px] font-semibold text-[#B42318]">
                          +{urgentes.length - 1} más
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[13px] text-[#4A5B78] line-clamp-2 break-words">{urgentes[0].mensaje}</p>
                  </div>
                  {urgentes[0].titulo === 'Acta por vencer' && urgentes[0].vence_en && (
                    <CuentaRegresiva venceEn={urgentes[0].vence_en} pequeno />
                  )}
                  <button
                    type="button"
                    onClick={abrirUrgentes}
                    className="shrink-0 rounded-lg bg-[#144193] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#0A2A62] active:scale-[0.98]"
                  >
                    {urgentes.length > 1 ? `Ver los ${urgentes.length}` : 'Ver detalle'}
                  </button>
                  {!esPersistente(urgentes[0]) && (
                    <button
                      type="button"
                      onClick={async () => {
                        await marcarUna(urgentes[0].id);
                        setUrgentesServidor((prev) => (prev ? prev.filter((x) => x.id !== urgentes[0].id) : prev));
                      }}
                      className="shrink-0 rounded-md p-1 text-[#6B7C99] transition-colors hover:bg-[#F4F7FC] hover:text-[#0A2A62]"
                      aria-label="Cerrar aviso"
                      title="Cerrar aviso (queda como leído)"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Avisos emergentes de lo que acaba de llegar */}
        <div className="fixed top-16 right-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)] space-y-2" aria-live="polite">
          {avisos.map((n) => {
            const { Icon, className } = iconoPorTipo(n.tipo);
            return (
              <div key={n.id} className="bg-white border border-numa-200 border-l-4 border-l-gold-500 rounded-md shadow-xl p-3 flex gap-3">
                <button type="button" onClick={() => abrirNotificacion(n)} className="flex gap-3 text-left min-w-0 flex-1">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${className}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-numa-900">{n.titulo}</p>
                    <p className="text-sm text-numa-700 line-clamp-3 break-words">{n.mensaje}</p>
                    <p className="text-xs text-gold-700 font-medium mt-1">Toca para ver el detalle</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setAvisos((prev) => prev.filter((x) => x.id !== n.id))}
                  className="p-1 text-numa-600 hover:text-numa-900 self-start"
                  aria-label="Cerrar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-6 pt-3 pb-5 max-w-7xl mx-auto">
          <div key={pathname} className="page-enter">{children}</div>
        </div>
      </main>

      <Modal open={!!detalle} onClose={() => setDetalle(null)} title={detalle ? (detalleLista.length > 1 ? `${detalle.titulo} (${detalleIdx + 1}/${detalleLista.length})` : detalle.titulo) : 'Notificación'}>
        {detalle && (
          <div>
            <p className="text-xs text-numa-700 mb-3">{fechaNotificacion(detalle.fecha_creacion)}</p>
            <p className="text-[15px] text-numa-900 whitespace-pre-line break-words leading-relaxed">
              {detalle.mensaje}
            </p>
            {detalleLista.length > 1 && (
              <div className="mt-5 flex items-center justify-between gap-2 rounded-xl border border-[#C5D2E6] bg-[#F4F7FC] px-2 py-1.5">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={detalleIdx === 0}
                  onClick={() => irA(detalleIdx - 1)}
                >
                  ‹ Anterior
                </button>
                <div className="flex items-center gap-1.5" aria-label={`Aviso ${detalleIdx + 1} de ${detalleLista.length}`}>
                  <span className="text-sm font-bold text-numa-900 tabular-nums">
                    {detalleIdx + 1} de {detalleLista.length}
                  </span>
                  <span className="flex gap-1">
                    {detalleLista.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-label={`Ir al aviso ${i + 1}`}
                        onClick={() => irA(i)}
                        className={`h-2 rounded-full transition-all ${i === detalleIdx ? 'w-5 bg-[#144193]' : 'w-2 bg-numa-300 hover:bg-numa-400'}`}
                      />
                    ))}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={detalleIdx === detalleLista.length - 1}
                  onClick={() => irA(detalleIdx + 1)}
                >
                  Siguiente ›
                </button>
              </div>
            )}
            <div className="flex justify-end gap-3 mt-4">
              <button type="button" className="btn-secondary" onClick={() => setDetalle(null)}>
                Cerrar
              </button>
              {destinoDe(detalle) && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    const destino = destinoDe(detalle)!;
                    setDetalle(null);
                    router.push(destino.ruta);
                  }}
                >
                  {destinoDe(detalle)!.texto}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
