'use client';

import { useState } from 'react';
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
  CalendarDays,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import clsx from 'clsx';

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/procesos', icon: FileText, label: 'Procesos de Mediación' },
  { href: '/actas-finales', icon: FileCheck, label: 'Actas Finales' },
  { href: '/clientes', icon: Users, label: 'Clientes' },
  { href: '/agenda', icon: CalendarDays, label: 'Agenda' },
  { href: '/sucursales', icon: Building2, label: 'Sucursales', adminOnly: true },
  { href: '/ciudades', icon: MapPin, label: 'Ciudades', adminOnly: true },
  { href: '/usuarios', icon: UserCircle, label: 'Usuarios', adminOnly: true },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdmin = user?.rol === 'administrador';

  const visibleNavItems = navItems.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    return true;
  });

  const SidebarContent = () => (
    <>
      <Link
        href="/dashboard"
        onClick={() => setMobileOpen(false)}
        className="flex items-center justify-center px-3 py-6 border-b border-numa-800"
      >
        <img
          src="/logo-numa.png"
          alt="NUMA"
          className="max-h-24 w-full object-contain"
        />
      </Link>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
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

      <div className="px-3 pb-4 border-t border-numa-800 pt-4">
        <div className="flex items-center gap-3 px-3 py-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-numa-700 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-white font-sans">
              {user?.username?.charAt(0)?.toUpperCase() ?? 'U'}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-white truncate font-sans">
              {user?.username}
            </p>
            <p className="text-xs text-white/50 capitalize font-sans">
              {user?.rol}
            </p>
          </div>
        </div>

        <Link
          href="/cambiar-password"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-3 w-full px-3 py-2 text-sm text-white hover:text-gold-400 hover:bg-numa-800 rounded-sm transition-colors font-sans"
        >
          <KeyRound className="w-4 h-4" />
          Cambiar contraseña
        </Link>

        <button
          onClick={logout}
          className="flex items-center gap-3 w-full px-3 py-2 text-sm text-white hover:text-red-400 hover:bg-red-400/5 rounded-sm transition-colors font-sans"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
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