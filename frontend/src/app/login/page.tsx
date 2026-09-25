'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Scale, Eye, EyeOff, ArrowLeft, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

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
      router.push('/dashboard');
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
  <div className="relative min-h-screen bg-white flex overflow-hidden">
    {/* Formas azules decorativas (a lo largo de toda la página) */}
    <div className="absolute -bottom-40 -left-24 w-96 h-96 bg-numa-50 rounded-full blur-3xl opacity-90" />
    <div className="absolute top-1/3 right-1/4 w-64 h-64 bg-gold-400/10 rounded-full blur-3xl" />

    {/* Patrón sutil */}
    <div className="absolute inset-0 opacity-[0.08] pointer-events-none">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, #C9D6E5 0, #C9D6E5 1px, transparent 0, transparent 50%)',
          backgroundSize: '22px 22px',
        }}
      />
    </div>

    {/* Panel izquierdo */}
    <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-numa-50 p-10 flex-col justify-between border-r border-numa-100">
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-numa-800 via-gold-500 to-numa-800" />

      <div className="relative z-10">
        <div className="inline-flex bg-numa-950 rounded-2xl shadow-xl p-3 border border-gold-500/30">
          <img
            src="/logo-numa.png"
            alt="NUMA Centro de Mediación"
            className="w-40 object-contain"
          />
        </div>
      </div>

      <div className="relative z-10 max-w-xl">
        <p className="text-sm font-semibold tracking-[0.25em] text-numa-700 uppercase mb-4">
          Centro de Mediación
        </p>

        <h1 className="text-4xl font-black text-gold-600 leading-tight mb-6">
          Gestión jurídica
          <span className="block text-gold-600">
            moderna y confiable
          </span>
        </h1>

        <p className="text-numa-700 leading-relaxed max-w-lg">
          Plataforma integral para administrar audiencias, actas,
          clientes, mediadores y trazabilidad documental.
        </p>

        <div className="mt-10 bg-white border-l-4 border-gold-400 shadow-sm rounded-r-2xl p-6">
          <p className="text-xl italic text-numa-900 leading-relaxed">
            “Priorizando la diplomacia sobre el conflicto.”
          </p>

          <span className="text-numa-500 text-sm mt-3 block">
            Inspirado en Numa Pompilio
          </span>
        </div>
      </div>

      <div className="relative z-10 text-sm text-numa-400">
        NUMA · Sistema Integral de Mediación
      </div>
    </div>

    {/* Login */}
    <div className="relative flex-1 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">

        {/* Mobile logo */}
        <div className="lg:hidden flex justify-center mb-8">
          <div className="bg-numa-950 rounded-2xl p-4 shadow-lg">
            <img
              src="/logo-numa.png"
              alt="NUMA"
              className="w-44 object-contain"
            />
          </div>
        </div>

        <div className="bg-white border border-numa-200 shadow-2xl rounded-3xl p-10 transition-all duration-300">

          <div className="mb-8 text-center">
            <h2 className="text-3xl font-bold text-numa-900 mb-2">
              Bienvenido
            </h2>

            <p className="text-numa-500">
              Ingrese sus credenciales para acceder al sistema
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">

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
              <label className="block text-sm font-semibold text-numa-700 mb-2">
                Usuario
              </label>

              <input
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-12 px-4 rounded-xl border border-numa-300 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent transition"
                placeholder="Ingrese su usuario"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-numa-700 mb-2">
                Contraseña
              </label>

              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-numa-300 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent transition pr-12"
                  placeholder="••••••••"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
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
              className="w-full h-12 rounded-xl bg-gradient-to-r from-gold-400 to-yellow-500 hover:from-gold-500 hover:to-yellow-600 text-numa-950 font-semibold transition shadow-lg disabled:opacity-60"
            >
              {isLoading
                ? 'Ingresando...'
                : 'Ingresar al Sistema'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-numa-100">
            <Link
              href="/"
              className="flex items-center justify-center gap-2 text-sm font-semibold text-numa-800 hover:text-gold-600 border border-numa-200 hover:border-gold-400 hover:bg-gold-50 rounded-lg py-2.5 transition-colors"
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
