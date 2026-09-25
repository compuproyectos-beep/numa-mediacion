'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  MapPin,
  Phone,
  ArrowLeft,
  Building2,
  ArrowRight
} from 'lucide-react';

import PublicNavbar from '@/components/public/PublicNavbar';
import PublicFooter from '@/components/public/PublicFooter';
import api from '@/lib/api';

export default function SedePage() {
  const params = useParams();
  const slug = String(params.slug);

  const [sede, setSede] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/sedes/${slug}`)
      .then((res) => setSede(res.data))
      .catch(() => setError('Sede no encontrada'))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <div className="min-h-screen bg-white">
      <PublicNavbar />

      <section className="relative pt-32 pb-20 bg-white text-numa-900 overflow-hidden">
        {/* Formas azules decorativas */}
        <div className="absolute -bottom-40 -left-24 w-96 h-96 bg-numa-50 rounded-full blur-3xl opacity-90" />
        <div className="absolute top-1/3 right-1/4 w-64 h-64 bg-gold-400/10 rounded-full blur-3xl" />

        {/* Pattern */}
        <div className="absolute inset-0 opacity-[0.08]">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, #C9D6E5 0, #C9D6E5 1px, transparent 0, transparent 50%)',
              backgroundSize: '22px 22px',
            }}
          />
        </div>

        {/* Top line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-numa-800 via-gold-500 to-numa-800" />

        <div className="relative max-w-7xl mx-auto px-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-numa-800 hover:text-gold-600 border border-numa-200 hover:border-gold-400 hover:bg-gold-50 rounded-full px-4 py-2 mb-10 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver al inicio
          </Link>

          {loading ? (
            <p className="text-numa-600">Cargando sede...</p>
          ) : error ? (
            <div>
              <h1 className="text-4xl font-bold mb-4 text-numa-900">Sede no encontrada</h1>
              <p className="text-numa-600">{error}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              <div>
                <div className="flex items-center gap-2 mb-5">
                  <div className="h-px w-12 bg-gold-500" />
                  <span className="text-gold-600 text-xs uppercase tracking-[0.3em]">
                    Sede NUMA
                  </span>
                </div>

                <h1 className="text-5xl font-bold leading-tight mb-4 text-numa-900">
                  Centro de Mediación
                  <span className="block text-gold-600">
                    {sede.nombre}
                  </span>
                </h1>

                <div className="flex items-center gap-2 mb-6">
                  <MapPin className="w-4 h-4 text-gold-600" />
                  <span className="text-numa-600 font-medium">
                    {sede.ciudad}, {sede.provincia}
                  </span>
                </div>

                <p className="text-numa-600 text-lg leading-relaxed max-w-xl">
                  Atención profesional en procesos de mediación, diálogo y
                  resolución pacífica de conflictos en {sede.ciudad}.
                </p>

                <div className="mt-8 flex flex-wrap gap-4">
                  <button
                   type="button"
                   className="inline-flex items-center gap-2 px-6 py-3 bg-gold-400 text-numa-950 text-sm font-semibold rounded-sm hover:bg-gold-500 transition-colors"
                  >
                    Consúltanos ahora
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <Link
                    href="/login"
                    className="inline-flex items-center gap-2 px-6 py-3 border border-numa-300 text-numa-700 text-sm font-medium rounded-sm hover:border-gold-400 hover:text-gold-600 hover:bg-gold-50 transition-colors"
                  >
                    Acceso al sistema
                  </Link>
                </div>
              </div>

              <div className="bg-white border border-numa-200 shadow-xl rounded-sm p-8">
                <div className="w-14 h-14 bg-gold-400 text-numa-950 rounded-sm flex items-center justify-center mb-6">
                  <Building2 className="w-7 h-7" />
                </div>

                <h2 className="text-2xl font-bold mb-6 text-numa-900">
                  Información de la sede
                </h2>

                <div className="space-y-5">
                  <div className="flex gap-3">
                    <MapPin className="w-5 h-5 text-gold-600 shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold text-numa-900">Dirección</p>
                      <p className="text-numa-600">
                        {sede.direccion || 'Dirección no registrada'}
                      </p>
                      <p className="text-numa-400 text-sm">
                        {sede.ciudad}, {sede.provincia}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Phone className="w-5 h-5 text-gold-600 shrink-0 mt-1" />
                    <div>
                      <p className="font-semibold text-numa-900">Teléfono</p>
                      <p className="text-numa-600">
                        {sede.telefono || 'No registrado'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="w-5 h-5 text-gold-600"
                    >
                      <path d="M22 12.07C22 6.503 17.523 2 12 2S2 6.503 2 12.07c0 5.017 3.657 9.177 8.438 9.93v-7.03H7.898v-2.9h2.54V9.845c0-2.52 1.492-3.913 3.777-3.913 1.094 0 2.238.196 2.238.196v2.474h-1.26c-1.243 0-1.63.776-1.63 1.572v1.887h2.773l-.443 2.9h-2.33V22c4.78-.753 8.437-4.913 8.437-9.93z" />
                    </svg>

                    <a
                      href="https://facebook.com/numamediacionec"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-base font-semibold text-numa-900 hover:text-gold-600 transition-colors"
                    >
                      Facebook 
                    </a>
                  </div>

                  <div className="border-t border-numa-100 pt-5">
                    <p className="text-xs uppercase tracking-[0.2em] text-gold-600 mb-2">
                      Código de sede
                    </p>
                    <p className="text-numa-600">
                      {sede.codigo} · {sede.prefijo}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-numa-900 mb-4">
            Mediación cercana, profesional y confiable
          </h2>

          <p className="text-numa-600 leading-relaxed max-w-3xl mx-auto">
            En NUMA promovemos soluciones pacíficas mediante procesos de
            mediación eficientes, confidenciales y orientados al entendimiento
            entre las partes.
          </p>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}