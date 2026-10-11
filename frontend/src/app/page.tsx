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
  Gavel,
  Wallet,
  Zap,
  HandHeart,
  Lock,
} from 'lucide-react';

import PublicNavbar from '@/components/public/PublicNavbar';
import PublicFooter from '@/components/public/PublicFooter';
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';

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
    // Versión en tono azul (igual a la paleta de la marca) de la misma
    // foto que se usa más abajo en la sección de Numa Pompilio — el
    // original es muy café y no dejaba leer bien el texto encima.
    src: '/images/numa-pompilio-azul.jpg',
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
    desc: 'El acta de mediación en la que consta el acuerdo tiene la misma fuerza legal que una sentencia ejecutoriada de última instancia: es de cumplimiento obligatorio y, si alguna de las partes no cumple, se puede exigir su ejecución sin iniciar un nuevo juicio. Lo que se acuerda aquí queda firme.',
  },
  {
    icon: Wallet,
    titulo: 'Ahorro económico',
    desc: 'Al evitar la vía judicial, la mediación supone un ahorro considerable de tiempo y dinero. Se reducen los honorarios de largos litigios, los gastos de trámite y los costos que genera mantener un conflicto abierto durante meses o años, tanto para personas como para empresas.',
  },
  {
    icon: Zap,
    titulo: 'Agilidad',
    desc: 'Un proceso de mediación puede resolverse entre una hora y un par de semanas, frente a los meses o años que puede tomar un juicio. Usted y la otra parte acuerdan los horarios, sin esperar turnos de audiencia ni plazos de un juzgado, y el caso se cierra cuando hay acuerdo.',
  },
  {
    icon: HandHeart,
    titulo: 'Voluntario',
    desc: 'Las partes participan por decisión propia y pueden retirarse si lo consideran necesario. Al no haber imposición, se reduce la confrontación, se escucha de verdad a la otra persona y se favorecen acuerdos que ambos sienten justos y, por eso, duraderos en el tiempo.',
  },
  {
    icon: Lock,
    titulo: 'Confidencialidad',
    desc: 'Todo lo que sucede en la mediación es estrictamente confidencial, se llegue o no a un acuerdo. Lo conversado no puede usarse después en un proceso judicial, lo que permite hablar con franqueza y buscar soluciones sin miedo a que sus palabras se utilicen en su contra.',
  },
  {
    icon: Users,
    titulo: 'Manejo efectivo de disputas',
    desc: 'Las partes involucradas controlan el resultado, sin depender de la decisión de un juez. Un mediador neutral e imparcial facilita el diálogo, ayuda a identificar intereses reales y a construir opciones de solución a la medida de cada caso, cuidando además la relación entre las partes.',
  },
];

export default function HomePage() {
  // Índice de la foto que se muestra ahora mismo en el carrusel del hero.
  // (El desplegable de Sedes que antes vivía aquí se quitó del banner —
  // ya está arriba, en el menú de PublicNavbar — así que esta página ya
  // no necesita traer la lista de sedes por su cuenta.)
  const [heroIndex, setHeroIndex] = useState(0);

  // Título del beneficio desplegado (hover en escritorio, toque en
  // celular). Solo uno a la vez.
  const [beneficioAbierto, setBeneficioAbierto] = useState<string | null>(null);

  useEffect(() => {
    const intervalo = setInterval(() => {
      setHeroIndex((i) => (i + 1) % heroImages.length);
    }, 5000);
    return () => clearInterval(intervalo);
  }, []);

  // Aparición suave al hacer scroll (un solo efecto, discreto). Si el
  // navegador pide "reducir movimiento" o falla el script, todo se ve normal.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const els = document.querySelectorAll<HTMLElement>('.reveal');
    document.documentElement.classList.add('js-reveal');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );
    els.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      document.documentElement.classList.remove('js-reveal');
    };
  }, []);

  return (
    <div className="min-h-screen bg-white font-brand">
      <PublicNavbar />

      {/* HERO — banner a todo lo ancho con las fotos ocupando toda la
          sección (como cme.com.ec), en vez de una foto chica en un
          recuadro al lado del texto. El texto va encima, con un degradado
          suave detrás para que se lea bien.
          Cada foto se ve COMPLETA (sin recortar) de fondo desenfocado de
          la misma foto, ampliada, rellena los bordes para que no queden
          franjas vacías — así no se pierde nada de la imagen original. */}
      <section className="relative min-h-[640px] sm:min-h-[720px] lg:min-h-[820px] flex items-center overflow-hidden rounded-b-[2rem] sm:rounded-b-[3.5rem]">
        {/* Carrusel de fondo, a todo lo ancho y alto de la sección.
            Tono oscuro neutro (no el azul intenso de numa-950) para que el
            fondo no se sienta "muy azulado". */}
        <div className="absolute inset-0 bg-[#0B141C]">
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
                className="object-cover opacity-50 sm:scale-110 sm:blur-2xl sm:opacity-60"
              />

              {/* Foto completa, sin recortar — con un margen fijo para que
                  no quede pegada al borde ni se sienta tan grande, aunque
                  su proporción case casi exacto con la del banner. */}
              <div className="hidden sm:block absolute inset-x-8 sm:inset-x-16 lg:inset-x-24 inset-y-10 sm:inset-y-14 lg:inset-y-16">
                <Image
                  src={img.src}
                  alt={img.alt}
                  fill
                  priority={i === 0}
                  sizes="100vw"
                  className="object-contain"
                />
              </div>
            </div>
          ))}

          {/* Degradado leve, solo para que el texto de la izquierda se lea
              bien — ya no oscurece toda la foto. Tono neutro, no azulado. */}
          {/* En celular la foto va de fondo (sin recuadro encima del texto), así que se oscurece un poco más para que el título se lea. */}
          <div className="absolute inset-0 bg-[#0B141C]/45 sm:hidden" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0B141C]/75 via-[#0B141C]/25 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B141C]/60 via-transparent to-[#0B141C]/10" />
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

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 sm:pt-28 pb-24 w-full">
          <div className="max-w-2xl">
            <div className="hero-rise flex items-center gap-2 mb-6">
              <div className="h-px w-12 bg-gold-500" />

              <span className="text-gold-400 text-xs uppercase tracking-[0.3em] font-sans">
                Desde 2010
              </span>
            </div>

            <h1 className="hero-rise hero-d1 text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-[1.08] mb-6">
              Centro de
              <br />
              <span className="text-gold-400">Mediación</span>
              <br />
              NUMA
            </h1>

            <p className="hero-rise hero-d2 text-lg text-numa-100 leading-relaxed mb-8 max-w-[22rem]">
              Promovemos el diálogo, la justicia y el entendimiento entre las
              partes.
            </p>

            {/* Un solo botón — Acceso al Sistema y Sedes ya están en el
                menú de arriba, no hace falta repetirlos aquí. */}
            <a
              href="#nosotros"
              className="hero-rise hero-d3 inline-flex items-center gap-3 pl-6 pr-2 py-2 bg-gold-400 text-numa-950 text-sm font-semibold rounded-full group hover:bg-gold-500 btn-press"
            >
              Conoce más <span className="btn-ico"><ArrowRight className="w-4 h-4" /></span>
            </a>
          </div>
        </div>
      </section>

      {/* NUMA POMPILIO — símbolo histórico detrás del nombre del centro.
          Va justo debajo del banner de fotos (antes de "Quiénes somos"),
          como una franja informativa chica — no una sección a página
          completa — con la foto más reducida. */}
      <section id="numa-pompilio" className="py-12 bg-parchment border-b border-gold-400/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-5 sm:gap-8 items-center">
            <div className="relative mx-auto sm:mx-0 w-32 sm:w-full rounded-t-full rounded-b-2xl overflow-hidden shadow-xl border border-numa-200">
              <Image
                src="/images/numa-pompilio.jpg"
                alt="Numa Pompilio, segundo rey de Roma, símbolo histórico de la mediación"
                width={360}
                height={420}
                className="w-full h-auto object-cover"
              />
            </div>

            <div className="text-center sm:text-left">
              <div className="flex justify-center sm:justify-start mb-2">
                <span className="inline-block rounded-full border border-gold-400/40 bg-gold-400/10 px-3.5 py-1 text-[11px] uppercase tracking-[0.2em] text-gold-600 font-sans">El origen de nuestro nombre</span>
              </div>

              <h2 className="text-xl sm:text-2xl font-bold text-numa-900 mb-2 leading-tight">
                Numa Pompilio, símbolo de mediador
              </h2>

              <p className="text-sm text-numa-600 leading-relaxed">
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

      {/* NOSOTROS */}
      <section id="nosotros" className="relative py-24 sm:py-32 bg-glow-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="flex mb-4">
                <span className="inline-block rounded-full border border-gold-400/40 bg-gold-400/10 px-3.5 py-1 text-[11px] uppercase tracking-[0.2em] text-gold-600 font-sans">Quiénes Somos</span>
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
                { num: '5', label: 'Sucursales activas' },
                { num: '98%', label: 'Satisfacción de clientes' },
              ].map((stat) => (
                <div key={stat.label} className="reveal bezel">
                <div className="bg-numa-900 rounded-[1.6rem] p-6 shadow-soft inner-hl">
                  <div className="text-3xl font-bold text-gold-400 mb-1 tabular-nums">
                    {stat.num}
                  </div>

                  <div className="text-sm text-numa-200 font-sans">
                    {stat.label}
                  </div>
                </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* MISION */}
      <div className="bg-white px-3 sm:px-6 py-3 sm:py-6">
      <section id="misión" className="relative py-20 sm:py-28 bg-night overflow-hidden rounded-[2rem] sm:rounded-[3.5rem]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1px_1fr] gap-12 md:gap-16 items-start">
            <div className="reveal">
              <div className="flex items-center gap-3 mb-6">
                <Scale className="w-6 h-6 text-gold-400" />
                <h2 className="text-base font-sans font-semibold uppercase tracking-[0.25em] text-gold-400">
                  Misión
                </h2>
              </div>
              <p className="text-2xl sm:text-3xl lg:text-[2.1rem] text-white leading-snug">
                Brindar servicios de mediación y resolución alternativa de
                conflictos de alta calidad.
              </p>
            </div>

            <div className="hidden md:block self-stretch w-px bg-gradient-to-b from-transparent via-gold-400/60 to-transparent" />
            <div className="md:hidden h-px bg-gradient-to-r from-transparent via-gold-400/60 to-transparent" />

            <div className="reveal reveal-d1">
              <div className="flex items-center gap-3 mb-6">
                <Eye className="w-6 h-6 text-gold-400" />
                <h2 className="text-base font-sans font-semibold uppercase tracking-[0.25em] text-gold-400">
                  Visión
                </h2>
              </div>
              <p className="text-2xl sm:text-3xl lg:text-[2.1rem] text-white leading-snug">
                Ser el centro de mediación líder reconocido por su excelencia.
              </p>
            </div>
          </div>
        </div>
      </section>
      </div>

      {/* VALORES */}
      <section id="valores" className="py-24 sm:py-32 bg-dots">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <h2 className="text-4xl font-bold text-numa-900">
              Valores Institucionales
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-12">
            {valores.map(({ icon: Icon, titulo, desc }, idx) => (
              <div
                key={titulo}
                className="reveal group"
                style={{ transitionDelay: `${idx * 70}ms` }}
              >
                
                <div className="w-12 h-14 rounded-t-full rounded-b-xl bg-numa-900 group-hover:bg-numa-800 flex items-center justify-center mb-5 transition-colors duration-300">
                  <Icon className="w-5 h-5 text-gold-400" />
                </div>
                <h3 className="text-xl font-bold text-numa-900 mb-2">{titulo}</h3>
                <p className="text-sm text-numa-600 leading-relaxed font-sans">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BENEFICIOS */}
      <section id="beneficios" className="py-24 sm:py-32 bg-parchment">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <div className="flex justify-center mb-4">
                <span className="inline-block rounded-full border border-gold-400/40 bg-gold-400/10 px-3.5 py-1 text-[11px] uppercase tracking-[0.2em] text-gold-600 font-sans">¿Por qué mediar?</span>
              </div>

            <h2 className="text-4xl font-bold text-numa-900">
              Beneficios de la Mediación
            </h2>
          </div>

          {/* Cada beneficio muestra un resumen recortado con "…" y se
              despliega completo, flotando por encima de las tarjetas
              vecinas, al pasar el mouse (escritorio) o al tocarlo
              (celular, donde no existe el hover). La celda externa tiene
              alto fijo para que al expandirse no se mueva el resto de
              la cuadrícula. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {beneficios.map(({ icon: Icon, titulo, desc }) => {
              const abierto = beneficioAbierto === titulo;
              return (
                <div key={titulo} className="relative h-[230px]">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={abierto}
                    onPointerEnter={(e) => {
                      if (e.pointerType === 'mouse') setBeneficioAbierto(titulo);
                    }}
                    onPointerLeave={(e) => {
                      if (e.pointerType === 'mouse') {
                        setBeneficioAbierto((prev) => (prev === titulo ? null : prev));
                      }
                    }}
                    onPointerUp={(e) => {
                      // El mouse ya abre/cierra con hover; el toque
                      // (celular/tablet) alterna al tocar la tarjeta.
                      if (e.pointerType !== 'mouse') {
                        setBeneficioAbierto((prev) => (prev === titulo ? null : titulo));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setBeneficioAbierto((prev) => (prev === titulo ? null : titulo));
                      }
                    }}
                    className={`absolute inset-x-0 top-0 min-h-full p-6 rounded-3xl border cursor-pointer transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${
                      abierto
                        ? 'z-20 bg-numa-900 border-gold-400/60 shadow-xl'
                        : 'z-0 bg-white border-numa-100'
                    }`}
                  >
                    <div
                      className={`w-11 h-11 rounded-full border flex items-center justify-center mb-4 transition-colors duration-300 ${
                        abierto
                          ? 'bg-gold-400/20 border-gold-400/40'
                          : 'bg-gold-400/10 border-gold-400/20'
                      }`}
                    >
                      <Icon
                        className={`w-5 h-5 transition-colors duration-300 ${
                          abierto ? 'text-gold-400' : 'text-gold-600'
                        }`}
                      />
                    </div>

                    <h3
                      className={`text-lg font-bold mb-2 transition-colors duration-300 ${
                        abierto ? 'text-gold-400' : 'text-numa-900'
                      }`}
                    >
                      {titulo}
                    </h3>

                    <p
                      className={`text-sm leading-relaxed font-sans transition-colors duration-300 ${
                        abierto ? 'text-numa-100' : 'text-numa-500 line-clamp-3'
                      }`}
                    >
                      {desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* SERVICIOS */}
      <section id="servicios" className="py-24 sm:py-32 bg-numa-50">
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

            <div className="reveal bezel"><div className="bg-numa-900 rounded-[1.6rem] p-10 sm:p-12 text-white shadow-soft inner-hl">
              <h3 className="text-2xl font-bold mb-3">
                ¿Necesita ayuda?
              </h3>

              <a
                href="#contacto-footer"
                className="mt-8 inline-flex items-center gap-3 pl-5 pr-2 py-2 group bg-gold-400 text-numa-950 text-sm font-semibold rounded-full hover:bg-gold-500 btn-press"
              >
                Contáctenos <span className="btn-ico"><ArrowRight className="w-4 h-4" /></span>
              </a>
            </div>
            </div>
          </div>
        </div>
      </section>

      {/* SOLICITA TU ASESORÍA */}
      <section id="contacto" className="py-24 sm:py-32 bg-numa-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="reveal bezel"><div className="bg-white rounded-[1.6rem] shadow-soft inner-hl-light p-10 sm:p-14">
            <div className="flex justify-center mb-4">
                <span className="inline-block rounded-full border border-gold-400/40 bg-gold-400/10 px-3.5 py-1 text-[11px] uppercase tracking-[0.2em] text-gold-600 font-sans">¿Tienes un conflicto que resolver?</span>
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
                className="inline-flex items-center gap-2 px-6 py-3 bg-green-500 text-white text-sm font-semibold rounded-full hover:bg-green-600 btn-press"
              >
                <WhatsAppIcon className="w-4 h-4" />
                Escríbenos por WhatsApp
              </a>

              <a
                href="mailto:numamediacionec@hotmail.com"
                className="inline-flex items-center gap-2 px-6 py-3 border border-numa-300 text-numa-700 text-sm font-medium rounded-full hover:border-gold-500 hover:text-gold-600 btn-press"
              >
                Escríbenos un correo
              </a>
            </div>
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
            className="inline-flex items-center gap-3 pl-8 pr-2.5 py-2.5 group bg-numa-950 text-white text-sm font-semibold rounded-full hover:bg-numa-800 btn-press"
          >
            Acceso al Sistema <span className="btn-ico btn-ico-light"><ArrowRight className="w-4 h-4" /></span>
          </Link>
        </div>
      </section>

      <PublicFooter />

      {/* BOTÓN FLOTANTE DE WHATSAPP */}
      <a
        href="https://wa.me/593981790092?text=Hola%2C%20quisiera%20informaci%C3%B3n%20sobre%20mediaci%C3%B3n"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-green-500 hover:bg-green-600 rounded-full shadow-2xl flex items-center justify-center btn-press"
        aria-label="Escríbenos por WhatsApp"
      >
        <WhatsAppIcon className="w-7 h-7 text-white" />
      </a>
    </div>
  );
}