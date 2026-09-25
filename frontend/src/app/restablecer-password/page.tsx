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
    <div className="relative min-h-screen bg-white flex items-center justify-center px-6 py-12 overflow-hidden">
      <div className="absolute -bottom-40 -left-24 w-96 h-96 bg-numa-50 rounded-full blur-3xl opacity-90" />
      <div className="absolute top-1/3 right-1/4 w-64 h-64 bg-gold-400/10 rounded-full blur-3xl" />
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-numa-800 via-gold-500 to-numa-800" />

      <div className="relative w-full max-w-md">
        <div className="bg-white border border-numa-200 shadow-2xl rounded-3xl p-10">
          {!token ? (
            <div className="text-center">
              <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
                <AlertCircle className="w-7 h-7 text-red-600" />
              </div>

              <h2 className="text-2xl font-bold text-numa-900 mb-3">
                Enlace inválido
              </h2>

              <p className="text-numa-500 leading-relaxed">
                Este enlace no tiene la información necesaria. Solicita uno nuevo.
              </p>
            </div>
          ) : listo ? (
            <div className="text-center">
              <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-5">
                <CheckCircle className="w-7 h-7 text-green-600" />
              </div>

              <h2 className="text-2xl font-bold text-numa-900 mb-3">
                ¡Contraseña actualizada!
              </h2>

              <p className="text-numa-500 leading-relaxed">
                Ya puedes ingresar al sistema con tu nueva contraseña.
                Te llevamos al inicio de sesión...
              </p>
            </div>
          ) : (
            <>
              <div className="mb-8 text-center">
                <h2 className="text-2xl font-bold text-numa-900 mb-2">
                  Establece tu contraseña
                </h2>

                <p className="text-numa-500">
                  Elige una contraseña de al menos 8 caracteres.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
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
                      className="w-full h-12 px-4 rounded-xl border border-numa-300 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent transition pr-12"
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
                    className="w-full h-12 px-4 rounded-xl border border-numa-300 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent transition"
                    placeholder="••••••••"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-12 rounded-xl bg-gradient-to-r from-gold-400 to-yellow-500 hover:from-gold-500 hover:to-yellow-600 text-numa-950 font-semibold transition shadow-lg disabled:opacity-60"
                >
                  {isLoading ? 'Guardando...' : 'Guardar contraseña'}
                </button>
              </form>
            </>
          )}

          <div className="mt-8 pt-6 border-t border-numa-100">
            <Link
              href="/login"
              className="flex items-center justify-center gap-2 text-sm font-semibold text-numa-800 hover:text-gold-600 border border-numa-200 hover:border-gold-400 hover:bg-gold-50 rounded-lg py-2.5 transition-colors"
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
