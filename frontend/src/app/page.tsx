'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Scale,
  Shield,
  Users,
  Eye,
  Heart,
  Star,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  Gavel,
  Wallet,
  Zap,
  HandHeart,
  Lock,
  MapPin,
} from 'lucide-react';

import PublicNavbar from '@/components/public/PublicNavbar';
import PublicFooter from '@/components/public/PublicFooter';
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';
import api from '@/lib/api';

const valores = [
  {
    icon: Shield,
    titulo: 'Integridad',
    desc: 'Actuamos con honestidad y transparencia en cada proceso de mediación.',
  },
  {
    icon: Heart,
    titulo: 'Empatía',
    desc: 'Escuchamos con atención y comprendemos la perspectiva de cada parte.',
  },
  {
    icon: Users,
    titulo: 'Colaboración',
    desc: 'Fomentamos el trabajo conjunto para alcanzar acuerdos duraderos.',
  },
  {
    icon: Star,
    titulo: 'Excelencia',
    desc: 'Garantizamos la más alta calidad en nuestros servicios y procesos.',
  },
];

const servicios = [
  'Mediación familiar',
  'Mediación civil',
  'Mediación de la mujer',
  'Mediación en niñez y adolescencia',
  'Mediación en inquilinato',
  'Mediación en tránsito',
  'Mediación comercial y empresarial',
  'Arbitraje y conciliación',
  'Mediación laboral',
  'Mediación comunitaria',
  'Capacitación en resolución de conflictos',
];

// Carrusel del hero: las fotos van rotando solas, con una transición suave
// (igual a lo que pidió el abogado, tipo cme.com.ec).
const heroImages = [
  {
    src: '/images/liderazgo-mediador.jpg',
    alt: 'Partes llegando a un acuerdo durante una sesión de mediación en NUMA',
  },
  {
    src: '/images/numa-pompilio.jpg',
    alt: 'Numa Pompilio, segundo rey de Roma, símbolo histórico de la mediación y la paz',
  },
  {
    src: '/images/oficina-matriz.jpg',
    alt: 'Oficina matriz del Centro de Mediación NUMA',
  },
];

const beneficios = [
  {
    icon: Gavel,
    titulo: 'Fuerza legal',
    desc: 'El acta de mediación tiene la misma fuerza legal que una sentencia ejecutoriada de última instancia.',
  },
  {
    icon: Wallet,
    titulo: 'Ahorro económico',
    desc: 'Al evitar la vía judicial, la mediación supone un ahorro considerable de tiempo y dinero.',
  },
  {
    icon: Zap,
    titulo: 'Agilidad',
    desc: 'Un proceso de mediación puede resolverse entre una hora y un par de semanas.',
  },
  {
    icon: HandHeart,
    titulo: 'Voluntario',
    desc: 'Las partes participan por decisión propia, lo que reduce la confrontación y favorece acuerdos duraderos.',
  },
  {
    icon: Lock,
    titulo: 'Confidencialidad',
    desc: 'Todo lo que sucede en la mediación es estrictamente confidencial, se llegue o no a un acuerdo.',
  },
  {
    icon: Users,
    titulo: 'Manejo efectivo de disputas',
    desc: 'Las partes involucradas controlan el resultado, sin depender de la decisión de un juez.',
  },
];

export default function HomePage() {
  const [sedes, setSedes] = useState<any[]>([]);

  // Índice de la foto que se muestra ahora mismo en el carrusel del hero.
  const [heroIndex, setHeroIndex] = useState(0);

  useEffect(() => {
    api
      .get('/sedes')
      .then((res) => setSedes(res.data))
      .catch(() => setSedes([]));
  }, []);

  useEffect(() => {
    const intervalo = setInterval(() => {
      setHeroIndex((i) => (i + 1) % heroImages.length);
    }, 5000);
    return () => clearInterval(intervalo);
  }, []);

  // El desplegable de Sedes ahora se agrupa Provincia → Ciudad → Sucursal
  // (antes solo mostraba ciudad y sucursal, y podía confundirse si dos
  // sucursales en ciudades distintas se llamaban igual). El backend ya
  // entrega las sedes ordenadas en ese mismo orden, así que aquí solo se
  // agrupan sin volver a ordenar.
  const sedesPorProvincia = sedes.reduce((acc: Record<string, Record<string, any[]>>, sede: any) => {
    const provincia = sede.provincia || 'Otras';
    const ciudad = sede.ciudad || 'Sin ciudad';

    if (!acc[provincia]) acc[provincia] = {};
    if (!acc[provincia][ciudad]) acc[provincia][ciudad] = [];
    acc[provincia][ciudad].push(sede);

    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-white font-display">
      <PublicNavbar />

      {/* HERO — banner a todo lo ancho con las fotos ocupando toda la
          sección (como cme.com.ec), en vez de una foto chica en un
          recuadro al lado del texto. El texto va encima, con un degradado
          suave detrás para que se lea bien.
          Cada foto se ve COMPLETA (sin recortar) de fondo desenfocado de
          la misma foto, ampliada, rellena los bordes para que no queden
          franjas vacías — así no se pierde nada de la imagen original. */}
      <section className="relative min-h-[640px] sm:min-h-[720px] lg:min-h-[820px] flex items-center overflow-hidden">
        {/* Carrusel de fondo, a todo lo ancho y alto de la sección */}
        <div className="absolute inset-0 bg-numa-950">
          {heroImages.map((img, i) => (
            <div
              key={img.src}
              className={`absolute inset-0 transition-opacity duration-1000 ${
                i === heroIndex ? 'opacity-100' : 'opacity-0'
              }`}
            >
              {/* Relleno desenfocado — ocupa todo el espacio */}
              <Image
                src={img.src}
                alt=""
                fill
                aria-hidden="true"
                sizes="100vw"
                className="object-cover scale-110 blur-2xl opacity-60"
              />

              {/* Foto completa, sin recortar */}
              <Image
                src={img.src}
                alt={img.alt}
                fill
                priority={i === 0}
                sizes="100vw"
                className="object-contain"
              />
            </div>
          ))}

          {/* Degradado leve, solo para que el texto de la izquierda se lea
              bien — ya no oscurece toda la foto. */}
          <div className="absolute inset-0 bg-gradient-to-r from-numa-950/75 via-numa-950/25 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-numa-950/60 via-transparent to-numa-950/10" />
        </div>

        {/* Top line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-numa-800 via-gold-500 to-numa-800 z-10" />

        {/* Indicadores del carrusel */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-2 z-10">
          {heroImages.map((img, i) => (
            <button
              key={img.src}
              type="button"
              onClick={() => setHeroIndex(i)}
              aria-label={`Mostrar foto ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === heroIndex ? 'w-6 bg-gold-400' : 'w-1.5 bg-white/60'
              }`}
            />
          ))}
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-32 sm:pt-40 pb-24 w-full">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-6">
              <div className="h-px w-12 bg-gold-500" />

              <span className="text-gold-400 text-xs uppercase tracking-[0.3em] font-sans">
                Desde 2010
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight mb-6">
              Centro de <span className="text-gold-400">Mediación</span> NUMA
            </h1>

            <p className="text-lg text-numa-100 leading-relaxed mb-8 max-w-xl">
              Somos una institución comprometida con la resolución pacífica de
              conflictos, promoviendo el diálogo, la justicia y el
              entendimiento entre las partes.
            </p>

            {/* BOTONES */}
            <div className="flex flex-wrap gap-4 mb-10">
              <a
                href="#nosotros"
                className="inline-flex items-center gap-2 px-6 py-3 bg-gold-400 text-numa-950 text-sm font-semibold rounded-sm hover:bg-gold-500 transition-colors"
              >
                Conoce más <ArrowRight className="w-4 h-4" />
              </a>

              <Link
                href="/login"
                className="inline-flex items-center gap-2 px-6 py-3 border border-white/40 text-white text-sm font-medium rounded-sm hover:border-gold-400 hover:text-gold-400 transition-colors"
              >
                Acceso al Sistema
              </Link>

              {/* BOTON SEDES */}
              <div className="relative group">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-6 py-3 border border-white/40 text-white text-sm font-medium rounded-sm hover:border-gold-400 hover:text-gold-400 transition-colors"
                >
                  Sedes
                  <ChevronDown className="w-4 h-4" />
                </button>

                  <div className="absolute bottom-full left-0 mb-2 w-72 max-h-80 overflow-y-auto bg-white border border-numa-100 shadow-2xl rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                  <div className="px-4 py-3 bg-numa-50 border-b border-numa-100 sticky top-0">
                    <span className="text-xs font-semibold uppercase tracking-wider text-numa-500">
                      Nuestras sedes
                    </span>
                  </div>

                  <div className="divide-y divide-numa-100">
                    {Object.entries(sedesPorProvincia).map(([provincia, ciudades]) => (
                      <div key={provincia}>
                        <div className="px-4 pt-3 pb-1 bg-numa-50/70">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-numa-700">
                            {provincia}
                          </span>
                        </div>

                        {Object.entries(ciudades).map(([ciudad, listaSedes]) => (
                          <div key={ciudad}>
                            <div className="px-5 pt-2 pb-1">
                              <span className="text-[11px] font-medium text-numa-400 uppercase tracking-wide">
                                {ciudad}
                              </span>
                            </div>

                            {listaSedes.map((sede: any) => (
                              <Link
                                key={sede.id}
                                href={`/sedes/${sede.slug}`}
                                className="flex items-center gap-3 pl-7 pr-4 py-2.5 hover:bg-gold-50 transition-colors group"
                              >
                                <MapPin className="w-3.5 h-3.5 text-numa-400 group-hover:text-gold-600 shrink-0" />

                                <span className="block text-sm font-semibold text-numa-900 truncate">
                                  {sede.nombre}
                                </span>
                              </Link>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* FRANJA DE CONFIANZA */}
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 pt-6 border-t border-white/20">
              <div className="flex items-center gap-2 text-sm text-numa-100">
                <Shield className="w-4 h-4 text-gold-400" />
                Mediación certificada
              </div>

              <div className="flex items-center gap-2 text-sm text-numa-100">
                <Users className="w-4 h-4 text-gold-400" />
                Equipo profesional
              </div>

              <div className="flex items-center gap-2 text-sm text-numa-100">
                <CheckCircle className="w-4 h-4 text-gold-400" />
                Acuerdos con validez legal
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* NOSOTROS */}
      <section id="nosotros" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="h-px w-8 bg-gold-400" />

                <span className="text-gold-600 text-xs uppercase tracking-[0.2em] font-sans">
                  Quiénes Somos
                </span>
              </div>

              <h2 className="text-4xl font-bold text-numa-900 mb-6 leading-tight">
                Más de una década construyendo puentes de paz
              </h2>

              <p className="text-numa-600 leading-relaxed mb-6">
                El Centro de Mediación NUMA es una institución reconocida en
                Ecuador por su compromiso con la resolución alternativa de
                disputas.
              </p>

              <p className="text-numa-600 leading-relaxed">
                Contamos con sucursales en las principales ciudades del país y
                hemos facilitado la resolución exitosa de conflictos.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {[
                { num: '1,000+', label: 'Casos resueltos' },
                { num: '10+', label: 'Años de experiencia' },
                { num: '8', label: 'Sucursales activas' },
                { num: '98%', label: 'Satisfacción de clientes' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="bg-numa-50 border border-numa-100 rounded-sm p-6"
                >
                  <div className="text-3xl font-bold text-numa-900 mb-1">
                    {stat.num}
                  </div>

                  <div className="text-sm text-numa-500 font-sans">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* NUMA POMPILIO — símbolo histórico detrás del nombre del centro */}
      <section id="numa-pompilio" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="relative mx-auto w-full max-w-md lg:max-w-none order-2 lg:order-1">
              <div className="relative rounded-sm overflow-hidden shadow-2xl border border-numa-200">
                <Image
                  src="/images/numa-pompilio.jpg"
                  alt="Numa Pompilio, segundo rey de Roma, símbolo histórico de la mediación"
                  width={900}
                  height={1000}
                  className="w-full h-[320px] sm:h-[380px] object-cover"
                />
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-px w-8 bg-gold-400" />

                <span className="text-gold-600 text-xs uppercase tracking-[0.2em] font-sans">
                  El origen de nuestro nombre
                </span>
              </div>

              <h2 className="text-4xl font-bold text-numa-900 mb-6 leading-tight">
                Numa Pompilio, símbolo de mediador
              </h2>

              <p className="text-numa-600 leading-relaxed">
                Numa Pompilio (c. 753-674 a.C.) fue el segundo rey de Roma,
                sucesor de Rómulo, reconocido como un monarca sabio, religioso
                y pacífico. Como símbolo de mediador, se destacó por
                establecer la paz con pueblos vecinos, reformar el calendario
                y organizar la religión romana, priorizando la diplomacia
                sobre la guerra.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* MISION */}
      <section id="misión" className="py-24 bg-numa-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-4xl font-bold text-numa-900">
              Misión y Visión
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white border border-numa-200 rounded-sm p-8">
              <div className="w-12 h-12 rounded-sm bg-gold-400/10 border border-gold-400/30 flex items-center justify-center mb-6">
                <Scale className="w-6 h-6 text-gold-600" />
              </div>

              <h3 className="text-xl font-bold text-numa-900 mb-4">
                Misión
              </h3>

              <p className="text-numa-600 leading-relaxed">
                Brindar servicios de mediación y resolución alternativa de
                conflictos de alta calidad.
              </p>
            </div>

            <div className="bg-white border border-numa-200 rounded-sm p-8">
              <div className="w-12 h-12 rounded-sm bg-gold-400/10 border border-gold-400/30 flex items-center justify-center mb-6">
                <Eye className="w-6 h-6 text-gold-600" />
              </div>

              <h3 className="text-xl font-bold text-numa-900 mb-4">
                Visión
              </h3>

              <p className="text-numa-600 leading-relaxed">
                Ser el centro de mediación líder reconocido por su excelencia.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* VALORES */}
      <section id="valores" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-4xl font-bold text-numa-900">
              Valores Institucionales
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {valores.map(({ icon: Icon, titulo, desc }) => (
              <div
                key={titulo}
                className="group p-6 border border-numa-100 rounded-sm hover:border-gold-400 hover:shadow-lg transition-all duration-200"
              >
                <div className="w-10 h-10 rounded-sm bg-numa-900 group-hover:bg-gold-400 flex items-center justify-center mb-4 transition-colors">
                  <Icon className="w-5 h-5 text-white group-hover:text-numa-950" />
                </div>

                <h3 className="text-lg font-bold text-numa-900 mb-2">
                  {titulo}
                </h3>

                <p className="text-sm text-numa-500 leading-relaxed font-sans">
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BENEFICIOS */}
      <section id="beneficios" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="h-px w-8 bg-gold-400" />

              <span className="text-gold-600 text-xs uppercase tracking-[0.2em] font-sans">
                ¿Por qué mediar?
              </span>

              <div className="h-px w-8 bg-gold-400" />
            </div>

            <h2 className="text-4xl font-bold text-numa-900">
              Beneficios de la Mediación
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {beneficios.map(({ icon: Icon, titulo, desc }) => (
              <div
                key={titulo}
                className="p-6 border border-numa-100 rounded-sm"
              >
                <div className="w-11 h-11 rounded-sm bg-gold-400/10 border border-gold-400/20 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-gold-600" />
                </div>

                <h3 className="text-lg font-bold text-numa-900 mb-2">
                  {titulo}
                </h3>

                <p className="text-sm text-numa-500 leading-relaxed font-sans">
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SERVICIOS */}
      <section id="servicios" className="py-24 bg-numa-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl font-bold text-numa-900 mb-4">
                Nuestros Servicios
              </h2>

              <ul className="space-y-3">
                {servicios.map((s) => (
                  <li key={s} className="flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-gold-500 shrink-0" />

                    <span className="text-numa-700 font-sans text-sm">
                      {s}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-numa-900 rounded-sm p-10 text-white">
              <h3 className="text-2xl font-bold mb-3">
                ¿Necesita ayuda?
              </h3>

              <a
                href="#contacto-footer"
                className="mt-8 inline-flex items-center gap-2 px-5 py-2.5 bg-gold-400 text-numa-950 text-sm font-semibold rounded-sm hover:bg-gold-500 transition-colors"
              >
                Contáctenos <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* SOLICITA TU ASESORÍA */}
      <section id="contacto" className="py-24 bg-numa-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="bg-white border border-numa-200 rounded-sm shadow-sm p-10 sm:p-14">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="h-px w-8 bg-gold-400" />

              <span className="text-gold-600 text-xs uppercase tracking-[0.2em] font-sans">
                ¿Tienes un conflicto que resolver?
              </span>

              <div className="h-px w-8 bg-gold-400" />
            </div>

            <h2 className="text-4xl font-bold text-numa-900 mb-4">
              Solicita una asesoría gratuita
            </h2>

            <p className="text-numa-600 mb-10 max-w-xl mx-auto leading-relaxed">
              Cuéntanos tu caso y te orientamos sobre cómo resolverlo a través
              de mediación, en el menor tiempo posible.
            </p>

            <div className="flex flex-wrap justify-center gap-4">
              <a
                href="https://wa.me/593981790092?text=Hola%2C%20quisiera%20una%20asesor%C3%ADa%20gratuita%20sobre%20mi%20caso"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-green-500 text-white text-sm font-semibold rounded-sm hover:bg-green-600 transition-colors"
              >
                <WhatsAppIcon className="w-4 h-4" />
                Escríbenos por WhatsApp
              </a>

              <a
                href="mailto:numamediacionec@hotmail.com"
                className="inline-flex items-center gap-2 px-6 py-3 border border-numa-300 text-numa-700 text-sm font-medium rounded-sm hover:border-gold-500 hover:text-gold-600 transition-colors"
              >
                Escríbenos un correo
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="acceso" className="py-20 bg-gold-400">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold text-numa-950 mb-4">
            Comience su proceso de mediación hoy
          </h2>

          <p className="text-numa-800 mb-8 font-sans">
            Si usted es parte del equipo NUMA, acceda al sistema de gestión.
          </p>

          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-numa-950 text-white text-sm font-semibold rounded-sm hover:bg-numa-800 transition-colors"
          >
            Acceso al Sistema <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      <PublicFooter />

      {/* BOTÓN FLOTANTE DE WHATSAPP */}
      <a
        href="https://wa.me/593981790092?text=Hola%2C%20quisiera%20informaci%C3%B3n%20sobre%20mediaci%C3%B3n"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-green-500 hover:bg-green-600 rounded-full shadow-2xl flex items-center justify-center transition-colors"
        aria-label="Escríbenos por WhatsApp"
      >
        <WhatsAppIcon className="w-7 h-7 text-white" />
      </a>
    </div>
  );
}