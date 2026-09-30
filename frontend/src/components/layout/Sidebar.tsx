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
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import clsx from 'clsx';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/procesos', icon: FileText, label: 'Procesos de Mediación' },
  { href: '/actas-finales', icon: FileCheck, label: 'Actas Finales' },
  { href: '/clientes', icon: Users, label: 'Clientes' },
  { href: '/agenda', icon: CalendarDays, label: 'Agenda' },
  { href: '/reportes', icon: BarChart3, label: 'Reportes' },
  { href: '/sucursales', icon: Building2, label: 'Sucursales', adminOnly: true },
  { href: '/ciudades', icon: MapPin, label: 'Ciudades', adminOnly: true },
  { href: '/usuarios', icon: UserCircle, label: 'Usuarios', adminOnly: true },
  { href: '/auditoria', icon: ClipboardList, label: 'Auditoría', adminOnly: true },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.rol === 'administrador';

  useEffect(() => {
    if (!userMenuOpen) return;

    const cerrarSiEsAfuera = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', cerrarSiEsAfuera);

    return () => document.removeEventListener('mousedown', cerrarSiEsAfuera);
  }, [userMenuOpen]);

  const visibleNavItems = navItems.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    return true;
  });

  const SidebarContent = () => (
    <>
      <Link
        href="/dashboard"
        onClick={() => setMobileOpen(false)}
        className="flex items-center justify-center px-3 py-4 border-b border-numa-800 shrink-0"
      >
        <img
          src="/logo-numa.png"
          alt="NUMA"
          className="max-h-16 w-full object-contain"
        />
      </Link>

      {/* Scroll propio: si el menú no cabe en pantallas más bajas, se
          desplaza solo aquí en vez de empujar el bloque de usuario (abajo)
          fuera de la vista sin poder llegar a él. */}
      <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-0.5">
        {visibleNavItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/');

          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm transition-all duration-150 group font-sans',
                active
                  ? 'bg-gold-400/10 text-gold-400 font-medium'
                  : 'text-white hover:text-gold-400 hover:bg-numa-800'
              )}
            >
              <Icon
                className={clsx(
                  'w-4 h-4 shrink-0',
                  active
                    ? 'text-gold-400'
                    : 'text-white/80 group-hover:text-gold-400'
                )}
              />
              <span className="flex-1">{label}</span>
              {active && <ChevronRight className="w-3 h-3 text-gold-400" />}
            </Link>
          );
        })}
      </nav>

      <div ref={userMenuRef} className="relative px-3 pb-3 border-t border-numa-800 pt-3 shrink-0">
        {userMenuOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-2 bg-numa-900 border border-numa-800 rounded-sm shadow-xl overflow-hidden">
            <Link
              href="/cambiar-password"
              onClick={() => {
                setUserMenuOpen(false);
                setMobileOpen(false);
              }}
              className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-white hover:text-gold-400 hover:bg-numa-800 transition-colors font-sans"
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
            'flex items-center gap-2.5 w-full px-3 py-2 rounded-sm transition-colors',
            userMenuOpen ? 'bg-numa-800' : 'hover:bg-numa-800'
          )}
        >
          <div className="w-8 h-8 rounded-full bg-numa-700 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-white font-sans">
              {(user?.nombre?.charAt(0) ?? user?.username?.charAt(0) ?? 'U').toUpperCase()}
            </span>
          </div>

          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-1.5">
              <p
                className="text-sm font-medium text-white truncate font-sans"
                title={user?.email}
              >
                {user?.nombre
                  ? `${user.nombre} ${user.apellido ?? ''}`.trim()
                  : user?.username}
              </p>
              <span className="shrink-0 text-[9px] font-medium capitalize text-gold-400 bg-gold-400/10 rounded-full px-1.5 py-0.5 font-sans">
                {user?.rol}
              </span>
            </div>
            <p
              className="text-[11px] text-white/40 truncate font-sans"
              title={user?.email}
            >
              {user?.email}
            </p>
          </div>

          <ChevronUp
            className={clsx(
              'w-3.5 h-3.5 text-white/40 shrink-0 transition-transform',
              userMenuOpen && 'rotate-180'
            )}
          />
        </button>
      </div>
    </>
  );

  return (
    <>
      <aside className="hidden lg:flex lg:flex-col w-56 bg-numa-950 h-screen fixed left-0 top-0 z-30 border-r border-numa-800">
        <SidebarContent />
      </aside>

      <header className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-numa-950 border-b border-numa-800 flex items-center justify-between px-4 h-14">
        <Link href="/dashboard" className="flex items-center">
          <img
            src="/logo-numa.png"
            alt="NUMA"
            className="h-9 w-auto object-contain"
          />
        </Link>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 text-white hover:text-gold-400"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </header>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />

          <aside className="absolute left-0 top-0 bottom-0 w-56 bg-numa-950 flex flex-col border-r border-numa-800">
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  );
}