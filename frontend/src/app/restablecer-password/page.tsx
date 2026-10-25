'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import { restablecerPassword } from '@/lib/services';

export default function RestablecerPasswordPage() {
  return (
    <Suspense fallback={null}>
      <RestablecerPasswordForm />
    </Suspense>
  );
}

function RestablecerPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [listo, setListo] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Este enlace no es válido. Solicita uno nuevo.');
      return;
    }

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    if (password !== confirmar) {
      setError('Las contraseñas no coinciden');
      return;
    }

    setIsLoading(true);

    try {
      await restablecerPassword(token, password);
      setListo(true);
      setTimeout(() => router.push('/login'), 3000);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(
        axiosErr?.response?.data?.detail ||
          'No se pudo actualizar la contraseña. Intenta de nuevo.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-[#0A2A62] via-[#144193] to-[#2358C9] flex items-center justify-center px-6 py-4 overflow-hidden font-brand font-display-jost font-todo-jost">
      <div className="hero-float-a pointer-events-none absolute -top-44 -right-24 w-[520px] h-[520px] rounded-full border-[70px] border-white/10" />
      <div className="hero-float-b pointer-events-none absolute -bottom-48 -left-20 w-[460px] h-[460px] rounded-full border-[56px] border-white/[0.08]" />
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-gold-400 to-transparent" />

      <div className="relative w-full max-w-md">
        <div className="flex justify-center mb-3">
          <Link href="/login" title="Ir al inicio de sesión" className="inline-flex bg-numa-950 rounded-xl p-2 border border-gold-500/30 shadow-xl hover:opacity-90 transition-opacity">
            <img src="/images/logo-numa-oscuro.jpg" alt="NUMA Centro de Mediación" className="w-16 object-contain rounded-md" />
          </Link>
        </div>
        <div className="tile-in bg-white border border-numa-100 border-t-4 border-t-gold-400 shadow-[0_30px_60px_-30px_rgba(3,12,35,0.7)] rounded-3xl p-6 sm:p-7">
          {!token ? (
            <div className="text-center">
              <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
                <AlertCircle className="w-7 h-7 text-red-600" />
              </div>

              <h2 className="text-2xl font-extrabold text-numa-900 mb-3">
                Enlace inválido
              </h2>

              <p className="text-numa-500 leading-relaxed">
                Este enlace no tiene la información necesaria. Solicita uno nuevo.
              </p>
            </div>
          ) : listo ? (
            <div className="text-center">
              <div className="w-11 h-11 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-5">
                <CheckCircle className="w-7 h-7 text-green-600" />
              </div>

              <h2 className="text-2xl font-extrabold text-numa-900 mb-3">
                ¡Contraseña actualizada!
              </h2>

              <p className="text-numa-500 leading-relaxed">
                Ya puedes ingresar al sistema con tu nueva contraseña.
                Te llevamos al inicio de sesión...
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 text-center">
                <h2 className="text-2xl font-extrabold text-numa-900 mb-2">
                  Establece tu contraseña
                </h2>

                <p className="text-numa-500">
                  Elige una contraseña de al menos 8 caracteres.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3.5">
                {error && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-red-700 text-sm">{error}</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-numa-700 mb-2">
                    Nueva contraseña
                  </label>

                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full h-11 px-4 rounded-xl border border-numa-300 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent transition pr-12"
                      placeholder="••••••••"
                    />

                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-numa-400 hover:text-numa-700"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-numa-700 mb-2">
                    Confirmar contraseña
                  </label>

                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={confirmar}
                    onChange={(e) => setConfirmar(e.target.value)}
                    className="w-full h-11 px-4 rounded-xl border border-numa-300 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent transition"
                    placeholder="••••••••"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 rounded-xl bg-gold-400 hover:bg-gold-500 text-numa-950 font-bold transition shadow-[0_12px_24px_-12px_rgba(201,154,46,0.95)] hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {isLoading ? 'Guardando...' : 'Guardar contraseña'}
                </button>
              </form>
            </>
          )}

          <div className="mt-4 pt-4 border-t border-numa-100">
            <Link
              href="/login"
              className="flex items-center justify-center gap-2 text-sm font-bold text-white bg-[#144193] hover:bg-[#1B4AAE] shadow-[0_12px_24px_-14px_rgba(10,42,98,0.9)] rounded-xl py-2 transition hover:-translate-y-0.5 active:scale-[0.98]"
            >
              <ArrowLeft className="w-4 h-4" />
              Volver al inicio de sesión
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
