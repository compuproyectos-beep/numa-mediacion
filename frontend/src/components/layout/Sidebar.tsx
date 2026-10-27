'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  FileCheck,
  Building2,
  MapPin,
  Users,
  UserCircle,
  LogOut,
  KeyRound,
  Menu,
  X,
  ChevronRight,
  ChevronUp,
  CalendarDays,
  BarChart3,
  ClipboardList,
  Receipt,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import clsx from 'clsx';

// Orden del trabajo diario: el proceso nace, se agenda, termina en acta.
// Lo de configuración (solo admin) va aparte, abajo.
// Color propio de cada ícono cuando el menú está encogido (sobre fondo azul oscuro).
const COLOR_ICONO: Record<string, string> = {
  '/dashboard': 'bg-sky-400/20 text-sky-300',
  '/procesos': 'bg-emerald-400/20 text-emerald-300',
  '/actas-finales': 'bg-amber-400/20 text-amber-300',
  '/agenda': 'bg-violet-400/25 text-violet-300',
  '/facturas-pagos': 'bg-teal-400/20 text-teal-300',
  '/clientes': 'bg-pink-400/20 text-pink-300',
  '/reportes': 'bg-orange-400/20 text-orange-300',
  '/usuarios': 'bg-indigo-400/25 text-indigo-300',
  '/sucursales': 'bg-cyan-400/20 text-cyan-300',
  '/ciudades': 'bg-lime-400/20 text-lime-300',
  '/auditoria': 'bg-rose-400/20 text-rose-300',
};

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Panel General' },
  { href: '/procesos', icon: FileText, label: 'Procesos' },
  { href: '/actas-finales', icon: FileCheck, label: 'Actas Finales' },
  { href: '/agenda', icon: CalendarDays, label: 'Agenda' },
  { href: '/facturas-pagos', icon: Receipt, label: 'Facturas y pagos' },
  { href: '/clientes', icon: Users, label: 'Clientes' },
  { href: '/reportes', icon: BarChart3, label: 'Reportes' },
  { href: '/usuarios', icon: UserCircle, label: 'Usuarios', adminOnly: true },
  { href: '/sucursales', icon: Building2, label: 'Sucursales', adminOnly: true },
  { href: '/ciudades', icon: MapPin, label: 'Ciudades', adminOnly: true },
  { href: '/auditoria', icon: ClipboardList, label: 'Auditoría', adminOnly: true },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  // En celular arranca abierto a propósito: es lo primero que ve el
  // mediador o admin al entrar (recién logueado o al refrescar), para que
  // note de una vez que ahí están las opciones del menú. En pantallas
  // grandes esto no se nota (el overlay de abajo es "lg:hidden"), así que
  // no hace falta distinguir el tamaño de pantalla aquí.
  const [mobileOpen, setMobileOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // Menú angosto (solo íconos) en pantallas grandes; se recuerda en el navegador.
  const [compacto, setCompacto] = useState(false);

  useEffect(() => {
    try {
      setCompacto(localStorage.getItem('numa_menu_compacto') === '1');
    } catch {}
  }, []);

  useEffect(() => {
    if (compacto) document.documentElement.setAttribute('data-menu', 'compacto');
    else document.documentElement.removeAttribute('data-menu');
    return () => document.documentElement.removeAttribute('data-menu');
  }, [compacto]);

  const alternarMenu = () => {
    setCompacto((v) => {
      try {
        localStorage.setItem('numa_menu_compacto', v ? '0' : '1');
      } catch {}
      return !v;
    });
    setUserMenuOpen(false);
  };
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Tamaño de letra fijo para todos (el valor está en globals.css). Se aplica
  // solo mientras el panel está abierto; las páginas de impresión no cambian.
  useEffect(() => {
    document.documentElement.setAttribute('data-tamano', 'fijo');
    return () => document.documentElement.removeAttribute('data-tamano');
  }, []);

  const isAdmin = user?.rol === 'administrador';
  // La secretaria solo trabaja con la Agenda, los Clientes y un reporte (Clientes).
  const esSecretaria = user?.rol === 'secretaria';
  const inicio = esSecretaria ? '/agenda' : '/dashboard';

  useEffect(() => {
    if (!userMenuOpen) return;

    const cerrarSiEsAfuera = (e: MouseEvent) => {
      // El menú del usuario existe dos veces en la página (barra de escritorio
      // y menú de celular), y un mismo ref solo apunta a una de las dos. Por eso
      // antes el clic en "Cerrar sesión" se tomaba como "clic afuera", el menú se
      // cerraba al presionar el mouse y el clic nunca llegaba al botón.
      if (!(e.target as HTMLElement | null)?.closest?.('[data-user-menu]')) {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', cerrarSiEsAfuera);

    return () => document.removeEventListener('mousedown', cerrarSiEsAfuera);
  }, [userMenuOpen]);

  const visibleNavItems = navItems.filter((item) => {
    if (esSecretaria) return item.href === '/agenda' || item.href === '/clientes' || item.href === '/reportes';
    if (item.adminOnly && !isAdmin) return false;
    return true;
  });

  const SidebarContent = ({ compacto = false }: { compacto?: boolean }) => (
    <>
      {compacto ? (
        <div className="flex items-center justify-center py-3 border-b border-white/10 shrink-0">
          <button
            type="button"
            onClick={alternarMenu}
            title="Ampliar menú"
            aria-label="Ampliar menú"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-400 text-[#0A2A62] shadow-md ring-1 ring-gold-400/60 hover:bg-gold-300 active:scale-95 transition-all"
          >
            <PanelLeftOpen className="w-6 h-6" />
          </button>
        </div>
      ) : (
        <div className="relative border-b border-white/10 shrink-0">
          <Link
            href={inicio}
            onClick={() => setMobileOpen(false)}
            className="flex items-center justify-center px-3 py-3"
          >
            <img
              src="/logo-numa.png"
              alt="NUMA"
              className="max-h-16 w-full object-contain"
            />
          </Link>
          <button
            type="button"
            onClick={alternarMenu}
            title="Encoger menú"
            aria-label="Encoger menú"
            className="hidden lg:flex absolute right-1.5 top-1.5 h-11 w-11 items-center justify-center rounded-xl bg-gold-400 text-[#0A2A62] shadow-md ring-1 ring-gold-400/60 hover:bg-gold-300 active:scale-95 transition-all"
          >
            <PanelLeftClose className="w-6 h-6" />
          </button>
        </div>
      )}

      {/* Scroll propio: si el menú no cabe en pantallas más bajas, se
          desplaza solo aquí en vez de empujar el bloque de usuario (abajo)
          fuera de la vista sin poder llegar a él. */}
      <nav className={clsx('flex-1 min-h-0 overflow-y-auto py-3 space-y-0.5', compacto ? 'px-2' : 'px-3')}>
        {visibleNavItems.map(({ href, icon: Icon, label, adminOnly }, i) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          const inicioAdmin = adminOnly && !visibleNavItems[i - 1]?.adminOnly;

          return (
            <div key={href}>
            {inicioAdmin && compacto && <div className="my-2 border-t border-white/10" />}
            {inicioAdmin && !compacto && (
              <p className="mt-2 mb-1 pt-2.5 px-3 border-t border-white/10 text-[10px] uppercase tracking-wider text-white/55 font-sans">
                Administración
              </p>
            )}
            <Link
              href={href}
              onClick={() => setMobileOpen(false)}
              title={compacto ? label : undefined}
              aria-label={label}
              className={clsx(
                'flex items-center rounded-lg text-sm transition-all duration-200 group font-sans',
                compacto ? 'justify-center py-1.5' : 'gap-3 px-3 py-2 hover:translate-x-0.5',
                compacto
                  ? 'hover:bg-white/10'
                  : active
                  ? 'bg-gold-400/15 text-gold-400 font-medium shadow-[inset_3px_0_0_#E0B84A]'
                  : 'text-white hover:text-gold-400 hover:bg-white/10'
              )}
            >
              {compacto ? (
                <span
                  className={clsx(
                    'flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ease-out group-hover:scale-110 group-hover:-translate-y-0.5 group-hover:shadow-lg group-active:scale-95 motion-reduce:transition-none motion-reduce:transform-none',
                    COLOR_ICONO[href] ?? 'bg-white/10 text-white',
                    active
                      ? 'ring-2 ring-gold-400 shadow-[0_0_0_3px_rgba(224,184,74,0.15)]'
                      : 'group-hover:brightness-125'
                  )}
                >
                  <Icon className="w-5 h-5" />
                </span>
              ) : (
                <Icon
                  className={clsx(
                    'w-4 h-4 shrink-0 transition-transform duration-200 group-hover:scale-125 motion-reduce:transform-none',
                    active
                      ? 'text-gold-400'
                      : 'text-white/80 group-hover:text-gold-400'
                  )}
                />
              )}
              {!compacto && <span className="flex-1 uppercase tracking-wide text-[11px]">{label}</span>}
              {!compacto && active && <ChevronRight className="w-3 h-3 text-gold-400" />}
            </Link>
            </div>
          );
        })}
      </nav>

      <div ref={userMenuRef} data-user-menu className={clsx('relative pb-3 border-t border-white/10 pt-3 shrink-0', compacto ? 'px-2' : 'px-3')}>
        {userMenuOpen && (
          <div className={clsx('absolute bg-[#0A2A62] border border-white/15 rounded-lg shadow-xl overflow-hidden z-50', compacto ? 'left-full bottom-2 ml-2 w-56' : 'bottom-full left-3 right-3 mb-2')}>
            <Link
              href="/cambiar-password"
              onClick={() => {
                setUserMenuOpen(false);
                setMobileOpen(false);
              }}
              className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-white hover:text-gold-400 hover:bg-white/10 transition-colors font-sans"
            >
              <KeyRound className="w-4 h-4" />
              Cambiar contraseña
            </Link>

            <button
              onClick={logout}
              className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-white hover:text-red-400 hover:bg-red-400/5 transition-colors font-sans"
            >
              <LogOut className="w-4 h-4" />
              Cerrar sesión
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setUserMenuOpen((v) => !v)}
          className={clsx(
            'flex items-center w-full rounded-sm transition-colors',
            compacto ? 'justify-center py-2' : 'gap-2.5 px-3 py-2',
            userMenuOpen ? 'bg-white/10' : 'hover:bg-white/10'
          )}
        >
          <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-white font-sans">
              {(user?.nombre?.charAt(0) ?? user?.username?.charAt(0) ?? 'U').toUpperCase()}
            </span>
          </div>

          <div className={clsx('min-w-0 flex-1 text-left', compacto && 'hidden')}>
            {/* Nombre solo en su línea para que se lea completo; el rol va debajo. */}
            <p
              className="text-sm font-medium text-white truncate font-sans leading-tight"
              title={user?.nombre ? `${user.nombre} ${user.apellido ?? ''}`.trim() : user?.username}
            >
              {user?.nombre
                ? `${user.nombre} ${user.apellido ?? ''}`.trim()
                : user?.username}
            </p>
            <span className="inline-block mt-1 text-[9px] font-medium capitalize text-gold-400 bg-gold-400/10 rounded-full px-1.5 py-0.5 font-sans">
              {user?.rol}
            </span>
            <p
              className="text-[11px] text-white/55 truncate font-sans"
              title={user?.email}
            >
              {user?.email}
            </p>
          </div>

          <ChevronUp
            className={clsx(
              compacto && 'hidden',
              'w-3.5 h-3.5 text-white/55 shrink-0 transition-transform',
              userMenuOpen && 'rotate-180'
            )}
          />
        </button>
      </div>
    </>
  );

  return (
    <>
      <aside className="menu-aside hidden lg:flex lg:flex-col bg-gradient-to-b from-[#16397A] via-[#112F6A] to-[#0B2250] fixed left-0 top-0 bottom-0 z-30 border-r border-white/10 shadow-[6px_0_24px_-12px_rgba(10,42,98,0.5)]">
        <SidebarContent compacto={compacto} />
      </aside>

      <header className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-[#112F6A] border-b border-white/10 flex items-center justify-between px-4 h-14">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 -ml-2 text-white hover:text-gold-400"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        <Link href={inicio} className="flex items-center">
          <img
            src="/logo-numa.png"
            alt="NUMA"
            className="h-9 w-auto object-contain"
          />
        </Link>

        {/* Espaciador invisible del mismo ancho que el botón, para que el
            logo quede centrado en vez de recostado a la izquierda. */}
        <span className="w-9 h-9" aria-hidden="true" />
      </header>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />

          <aside className="absolute left-0 top-0 bottom-0 w-56 bg-gradient-to-b from-[#16397A] via-[#112F6A] to-[#0B2250] flex flex-col border-r border-white/10">
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  );
}