'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  MapPin,
  Phone,
  ArrowLeft,
  Building2,
  ArrowRight,
} from 'lucide-react';
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';
import FacebookIcon from '@/components/icons/FacebookIcon';

import BotonInicio from '@/components/public/BotonInicio';
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

  const telefonoSede = sede?.telefono_coordinador || sede?.telefono || '';
  const telefonoLimpio = telefonoSede.replace(/[^0-9+]/g, '');

  return (
    <div className="min-h-screen bg-white font-brand">
      <PublicNavbar />
      <BotonInicio soloAncho />

      <section className="relative pt-40 sm:pt-44 pb-16 sm:pb-20 bg-gradient-to-br from-[#0A2A62] via-[#144193] to-[#2358C9] text-white overflow-hidden">
        {/* Línea dorada superior (la misma de la portada) */}
        <div className="hero-float-a pointer-events-none absolute -top-40 -right-24 w-[480px] h-[480px] rounded-full border-[64px] border-white/10" />
        <div className="hero-float-b pointer-events-none absolute -bottom-44 -left-20 w-[420px] h-[420px] rounded-full border-[52px] border-white/[0.08]" />
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-gold-400 to-transparent" />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-bold text-[#0A2A62] bg-gold-400 hover:bg-gold-300 rounded-full px-4 py-2 mb-10 btn-press shadow-[0_12px_24px_-12px_rgba(224,184,74,0.9)]"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver al inicio
          </Link>

          {loading ? (
            <p className="text-blue-100">Cargando sede...</p>
          ) : error ? (
            <div>
              <h1 className="text-4xl font-bold mb-4 text-white">Sede no encontrada</h1>
              <p className="text-blue-100">{error}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-14 items-center">
              <div>
                <span className="inline-block rounded-full border border-gold-400 bg-[#0A2A62] px-4 py-1.5 text-xs sm:text-[13px] font-bold uppercase tracking-[0.18em] text-gold-300 font-sans mb-5">
                  Sede NUMA
                </span>

                <h1 className="text-4xl sm:text-5xl font-bold leading-tight mb-4 text-white">
                  Centro de Mediación
                  <span className="block text-gold-300">{sede.nombre}</span>
                </h1>

                <div className="flex items-center gap-2 mb-6">
                  <MapPin className="w-4 h-4 text-gold-300" />
                  <span className="text-blue-100 font-medium">
                    {sede.ciudad}, {sede.provincia}
                  </span>
                </div>

                <p className="text-blue-100 text-lg leading-relaxed max-w-xl">
                  Atención profesional en procesos de mediación, diálogo y
                  resolución pacífica de conflictos en {sede.ciudad}.
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  <a
                    href={`https://wa.me/593981790092?text=${encodeURIComponent(
                      `Hola, quisiera información sobre la sede ${sede.nombre} de ${sede.ciudad}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-green-500 text-white text-sm font-semibold rounded-full hover:bg-green-600 btn-press"
                  >
                    <WhatsAppIcon className="w-4 h-4" />
                    Consúltanos por WhatsApp
                  </a>

                  <Link
                    href="/login"
                    className="inline-flex items-center gap-2 px-6 py-3 border border-white/40 text-white text-sm font-semibold rounded-full hover:border-gold-400 hover:text-gold-300 hover:bg-white/10 btn-press"
                  >
                    Acceso al sistema
                  </Link>
                </div>
              </div>

              <div className="bezel">
                <div className="bg-white rounded-[1.6rem] shadow-soft inner-hl-light p-7 sm:p-9">
                  <div className="w-12 h-14 rounded-t-full rounded-b-xl bg-numa-900 flex items-center justify-center mb-6">
                    <Building2 className="w-5 h-5 text-gold-400" />
                  </div>

                  <h2 className="text-2xl font-bold mb-6 text-numa-900">
                    Información de la sede
                  </h2>

                  <dl className="divide-y divide-numa-100">
                    <div className="flex gap-4 py-4 first:pt-0">
                      <MapPin className="w-5 h-5 text-gold-600 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <dt className="font-semibold text-numa-900">Dirección</dt>
                        <dd className="text-numa-600">
                          {sede.direccion || 'Dirección no registrada'}
                        </dd>
                        <dd className="text-numa-400 text-sm">
                          {sede.ciudad}, {sede.provincia}
                        </dd>
                      </div>
                    </div>

                    <div className="flex gap-4 py-4">
                      <Phone className="w-5 h-5 text-gold-600 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <dt className="font-semibold text-numa-900">Teléfono</dt>
                        <dd className="text-numa-600">
                          {telefonoSede ? (
                            <a href={`tel:${telefonoLimpio}`} className="hover:text-gold-600">
                              {telefonoSede}
                            </a>
                          ) : (
                            'No registrado'
                          )}
                        </dd>
                      </div>
                    </div>

                    <div className="flex gap-4 py-4 last:pb-0">
                      <FacebookIcon className="w-5 h-5 text-gold-600 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <dt className="font-semibold text-numa-900">Facebook</dt>
                        <dd>
                          <a
                            href="https://www.facebook.com/profile.php?id=61594906720744"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-numa-600 hover:text-gold-600"
                          >
                            NUMA Centro de Mediación
                          </a>
                        </dd>
                      </div>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="bg-white px-3 sm:px-6 py-2 sm:py-4">
        <section className="relative py-12 sm:py-16 bg-gradient-to-br from-[#0A2A62] via-[#144193] to-[#2358C9] overflow-hidden rounded-[1.75rem] sm:rounded-[2.5rem]">
          <div className="max-w-3xl mx-auto px-5 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              Mediación cercana, profesional y confiable
            </h2>

            <p className="text-numa-100 leading-relaxed">
              En NUMA promovemos soluciones pacíficas mediante procesos de
              mediación eficientes, confidenciales y orientados al
              entendimiento entre las partes.
            </p>
          </div>
        </section>
      </div>

      <PublicFooter />
    </div>
  );
}
