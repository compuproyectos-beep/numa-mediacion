'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import BotonInicio from '@/components/public/BotonInicio';
import { Eye, EyeOff, ArrowLeft, AlertCircle, CheckCircle, CalendarCheck, FileCheck, ShieldCheck, User, Lock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getUser } from '@/lib/auth';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const passwordActualizada = searchParams.get('password_actualizada') === '1';
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(username, password);
      router.push(getUser()?.rol === 'secretaria' ? '/agenda' : '/dashboard');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string }; status?: number } };
      if (axiosErr?.response?.status === 401) {
        setError('Credenciales incorrectas. Verifique su usuario y contraseña.');
      } else {
        setError('Error al conectar con el servidor. Intente nuevamente.');
      }
    } finally {
      setIsLoading(false);
    }
  };

return (
  <div className="relative min-h-screen lg:h-screen lg:overflow-hidden flex bg-[#F2F5FB] font-brand font-display-jost font-todo-jost">
    <BotonInicio />
    {/* Panel izquierdo: azul con degradado y círculos que flotan */}
    <div className="hidden lg:flex lg:w-[48%] relative overflow-hidden bg-gradient-to-br from-[#0A2A62] via-[#144193] to-[#2358C9] p-6 xl:p-8 flex-col justify-between gap-3 text-white">
      <div className="hero-float-a pointer-events-none absolute -top-44 -right-24 w-[520px] h-[520px] rounded-full border-[70px] border-white/10" />
      <div className="hero-float-b pointer-events-none absolute -bottom-48 -left-20 w-[460px] h-[460px] rounded-full border-[56px] border-white/[0.08]" />
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-gold-400 to-transparent" />

      <div className="relative z-10 tile-in">
        <Link
          href="/"
          className="inline-flex bg-numa-950 rounded-xl shadow-xl p-2 border border-gold-500/30 hover:opacity-90 transition-opacity"
          title="Volver a la página principal"
        >
          <img
            src="/images/logo-numa-oscuro.jpg"
            alt="NUMA Centro de Mediación"
            className="w-20 xl:w-24 object-contain rounded-md"
          />
        </Link>
      </div>

      <div className="relative z-10 max-w-xl">
        <h1 className="tile-in text-3xl xl:text-4xl font-extrabold tracking-tight leading-[1.05]" style={{ animationDelay: '0.1s' }}>
          Gestión jurídica
          <span className="block text-gold-300">moderna y confiable</span>
        </h1>

        <p className="tile-in mt-2 text-blue-100 text-[15px] xl:text-base leading-relaxed max-w-md" style={{ animationDelay: '0.2s' }}>
          Audiencias, actas, clientes y mediadores en un solo lugar, con
          trazabilidad de cada paso.
        </p>

        <div className="mt-3 xl:mt-5 grid gap-2 max-w-md">
          {[
            [CalendarCheck, 'Agenda e invitaciones', 'Cada reunión, siempre a la vista'],
            [FileCheck, 'Actas y procesos', 'Del número de acta al archivo final'],
            [ShieldCheck, 'Trazabilidad', 'Quién hizo qué y cuándo']
          ].map(([Icon, titulo, texto], i) => {
            const I = Icon as React.ComponentType<{ className?: string }>;
            return (
              <div
                key={titulo as string}
                className="tile-in flex items-center gap-4 rounded-2xl bg-white/[0.12] border border-gold-400/45 px-3 py-1.5 xl:py-2.5 backdrop-blur-sm shadow-[0_12px_24px_-16px_rgba(7,27,69,0.8)] transition duration-200 hover:bg-white/[0.18] hover:border-gold-400 hover:translate-x-1"
                style={{ animationDelay: `${0.3 + i * 0.1}s` }}
              >
                <span className="w-8 h-8 xl:w-10 xl:h-10 rounded-xl bg-gold-400 text-[#0A2A62] flex items-center justify-center shrink-0">
                  <I className="w-5 h-5" />
                </span>
                <div>
                  <p className="font-bold text-[15px] leading-tight text-white">{titulo as string}</p>
                  <p className="text-blue-50 text-[13px] leading-snug">{texto as string}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative z-10 tile-in" style={{ animationDelay: '0.6s' }}>
        <p className="italic text-blue-100 text-[13px]">
          “Priorizando la diplomacia sobre el conflicto.” · Inspirado en Numa Pompilio
        </p>
        <p className="mt-1 text-xs text-blue-200/80">NUMA · Sistema Integral de Mediación</p>
      </div>
    </div>

    {/* Formulario */}
    <div className="relative flex-1 flex items-center justify-center px-6 py-6 overflow-hidden">
      <div className="hero-float-b pointer-events-none absolute -top-32 -right-24 w-80 h-80 rounded-full bg-gold-400/15 blur-3xl" />
      <div className="w-full max-w-md relative">

        {/* Logo en celular */}
        <div className="lg:hidden flex justify-center mb-8">
          <Link
            href="/"
            className="bg-numa-950 rounded-2xl p-4 shadow-lg hover:opacity-90 transition-opacity"
            title="Volver a la página principal"
          >
            <img
              src="/images/logo-numa-oscuro.jpg"
              alt="NUMA"
              className="w-44 object-contain rounded-md"
            />
          </Link>
        </div>

        <div className="tile-in bg-white border border-numa-100 shadow-[0_30px_60px_-30px_rgba(11,39,89,0.45)] rounded-3xl p-6 sm:p-8 border-t-4 border-t-gold-400">

          <div className="mb-5">
            <h2 className="text-3xl font-extrabold tracking-tight text-numa-900 mb-2">
              Bienvenido
            </h2>
            <div className="h-1 w-12 rounded-full bg-gold-400 mb-3" />

            <p className="text-numa-500">
              Ingrese sus credenciales para acceder al sistema
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">

            {passwordActualizada && !error && (
              <div className="flex items-start gap-2 p-4 bg-green-50 border border-green-200 rounded-xl">
                <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />

                <p className="text-green-700 text-sm">
                  Tu contraseña se actualizó correctamente. Ingresa con tu nueva contraseña.
                </p>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-xl">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />

                <p className="text-red-700 text-sm">
                  {error}
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-numa-700 mb-2">
                Usuario
              </label>

              <div className="relative">
              <User className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-numa-400" />
              <input
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-11 pl-11 pr-4 rounded-xl border border-numa-300 bg-numa-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-transparent transition"
                placeholder="Ingrese su usuario"
              />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-numa-700 mb-2">
                Contraseña
              </label>

              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-numa-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 pl-11 pr-12 rounded-xl border border-numa-300 bg-numa-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-transparent transition"
                  placeholder="••••••••"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-numa-400 hover:text-numa-700"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>

              <div className="text-right mt-2">
                <Link
                  href="/olvide-password"
                  className="text-sm text-numa-500 hover:text-gold-600 transition-colors"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 rounded-xl bg-gold-400 hover:bg-gold-500 text-numa-950 font-bold transition shadow-[0_12px_24px_-12px_rgba(201,154,46,0.95)] hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {isLoading
                ? 'Ingresando...'
                : 'Ingresar al Sistema'}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-numa-100">
            <Link
              href="/"
              className="flex items-center justify-center gap-2 text-sm font-bold text-white bg-[#144193] hover:bg-[#1B4AAE] shadow-[0_12px_24px_-14px_rgba(10,42,98,0.9)] rounded-xl py-2.5 transition hover:-translate-y-0.5 active:scale-[0.98]"
            >
              <ArrowLeft className="w-4 h-4" />
              Volver al sitio institucional
            </Link>
          </div>
        </div>
      </div>
    </div>
  </div>
);
}
