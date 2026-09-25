'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Mail, CheckCircle } from 'lucide-react';
import { solicitarRecuperacion } from '@/lib/services';

export default function OlvidePasswordPage() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await solicitarRecuperacion(email);
      setEnviado(true);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(
        axiosErr?.response?.data?.detail ||
          'No se pudo procesar la solicitud. Intenta de nuevo.'
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
          {enviado ? (
            <div className="text-center">
              <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-5">
                <CheckCircle className="w-7 h-7 text-green-600" />
              </div>

              <h2 className="text-2xl font-bold text-numa-900 mb-3">
                Revisa tu correo
              </h2>

              <p className="text-numa-500 leading-relaxed">
                Si <strong>{email}</strong> está registrado en el sistema,
                te enviamos un enlace para restablecer tu contraseña.
                Revisa también la carpeta de spam.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-8 text-center">
                <div className="w-14 h-14 bg-numa-50 rounded-full flex items-center justify-center mx-auto mb-5">
                  <Mail className="w-6 h-6 text-gold-600" />
                </div>

                <h2 className="text-2xl font-bold text-numa-900 mb-2">
                  ¿Olvidaste tu contraseña?
                </h2>

                <p className="text-numa-500">
                  Ingresa tu correo y te enviaremos un enlace para restablecerla.
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
                    Correo electrónico
                  </label>

                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-12 px-4 rounded-xl border border-numa-300 focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-transparent transition"
                    placeholder="tu.correo@ejemplo.com"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-12 rounded-xl bg-gradient-to-r from-gold-400 to-yellow-500 hover:from-gold-500 hover:to-yellow-600 text-numa-950 font-semibold transition shadow-lg disabled:opacity-60"
                >
                  {isLoading ? 'Enviando...' : 'Enviar enlace'}
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
