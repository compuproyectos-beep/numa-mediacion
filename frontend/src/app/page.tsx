'use client';

import { useEffect, useRef, useState } from 'react';
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
  MapPin,
  Mail,
  ChevronDown,
} from 'lucide-react';

import PublicNavbar from '@/components/public/PublicNavbar';
import PublicFooter from '@/components/public/PublicFooter';
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';
import FacebookIcon from '@/components/icons/FacebookIcon';

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
  'Mediación de la mujer, niñez y adolescencia',
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
    // Versión en tono azul (igual a la paleta de la marca) de la misma
    // foto que se usa más abajo en la sección de Numa Pompilio — el
    // original es muy café y no dejaba leer bien el texto encima.
    src: '/images/numa-pompilio-azul.jpg',
    alt: 'Numa Pompilio, segundo rey de Roma, símbolo histórico de la mediación y la paz',
  },
  {
    src: '/images/liderazgo-mediador.jpg',
    alt: 'Partes llegando a un acuerdo durante una sesión de mediación en NUMA',
  },
  {
    src: '/images/familia-ninez.jpg',
    alt: 'Mediador conversando con una familia y una niña durante una sesión de mediación',
  },
  {
    src: '/images/obreros-casco.jpg',
    alt: 'Dos trabajadores con casco conversando en una obra',
  },
  {
    src: '/images/transito-policia.jpg',
    alt: 'Agente de policía conversando con un ciudadano',
  },
  {
    src: '/images/comunidad-circulo.jpg',
    alt: 'Personas de la comunidad dialogando sentadas en círculo al aire libre',
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

// Arcos decorativos que flotan despacio detrás de las secciones claras
// (el arco es el símbolo de la página). Solo se ven en pantallas anchas.
function Arcos() {
  const arcos = [
    { left: '2%', top: '10%', w: 64, h: 96, d: '0s' },
    { left: '5%', top: '58%', w: 44, h: 68, d: '-3s' },
    { right: '3%', top: '16%', w: 52, h: 80, d: '-5s' },
    { right: '1.5%', top: '64%', w: 72, h: 108, d: '-8s' },
  ] as const;
  return (
    <>
      {arcos.map((a, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="deco-arch hidden xl:block"
          style={{ left: (a as any).left, right: (a as any).right, top: a.top, width: a.w, height: a.h, animationDelay: a.d }}
        />
      ))}
    </>
  );
}

// Barra dorada fina arriba que avanza al bajar por la página.
function BarraProgreso() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const act = () => {
      const alto = document.documentElement.scrollHeight - window.innerHeight;
      const p = alto > 0 ? Math.min(1, window.scrollY / alto) : 0;
      if (ref.current) ref.current.style.transform = `scaleX(${p})`;
    };
    act();
    window.addEventListener('scroll', act, { passive: true });
    window.addEventListener('resize', act);
    return () => {
      window.removeEventListener('scroll', act);
      window.removeEventListener('resize', act);
    };
  }, []);
  return (
    <div className="fixed top-0 inset-x-0 z-[60] h-[3px] pointer-events-none" aria-hidden="true">
      <div ref={ref} className="h-full origin-left bg-gradient-to-r from-gold-500 via-gold-300 to-gold-500" style={{ transform: 'scaleX(0)' }} />
    </div>
  );
}

// Cuenta hacia arriba cuando la cifra aparece en pantalla; el texto final
// es exactamente el mismo de siempre (por ejemplo "1,000+" o "98%").
function CifraAnimada({ texto }: { texto: string }) {
  const m = texto.match(/^([\d,]+)(.*)$/);
  const destino = m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
  const sufijo = m ? m[2] : '';
  const conComa = !!m && m[1].includes(',');
  const [valor, setValor] = useState<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!m || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        const ini = performance.now();
        const paso = (t: number) => {
          const k = Math.min(1, (t - ini) / 1400);
          setValor(Math.round(destino * (1 - Math.pow(1 - k, 3))));
          if (k < 1) raf = requestAnimationFrame(paso);
        };
        raf = requestAnimationFrame(paso);
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mostrado = valor === null ? destino : valor;
  return (
    <span ref={ref}>
      {conComa ? mostrado.toLocaleString('en-US') : mostrado}
      {sufijo}
    </span>
  );
}

export default function HomePage() {
  // Índice de la foto que se muestra ahora mismo en el carrusel del hero.
  // (El desplegable de Sedes que antes vivía aquí se quitó del banner —
  // ya está arriba, en el menú de PublicNavbar — así que esta página ya
  // no necesita traer la lista de sedes por su cuenta.)
  const [heroIndex, setHeroIndex] = useState(0);

  // El arco de la portada se inclina muy poco siguiendo el mouse.
  const portalRef = useRef<HTMLDivElement>(null);
  const inclinarPortal = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = portalRef.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${x * 7}deg) rotateX(${-y * 5}deg)`;
  };
  const enderezarPortal = () => {
    if (portalRef.current) portalRef.current.style.transform = '';
  };

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
    <div className="min-h-screen bg-white font-brand font-display-jost">
      <BarraProgreso />
      <PublicNavbar />

      {/* HERO — banner a todo lo ancho con las fotos ocupando toda la
          sección (como cme.com.ec), en vez de una foto chica en un
          recuadro al lado del texto. El texto va encima, con un degradado
          suave detrás para que se lea bien.
          Cada foto se ve COMPLETA (sin recortar) de fondo desenfocado de
          la misma foto, ampliada, rellena los bordes para que no queden
          franjas vacías — así no se pierde nada de la imagen original. */}
      <section className="relative min-h-[100svh] flex items-center overflow-hidden bg-[#071B45] text-white">
        {/* Campo azul profundo con luz detrás del arco */}
        <div className="absolute inset-0 bg-[radial-gradient(70%_75%_at_72%_42%,#2358C9_0%,#144193_40%,#071B45_78%)]" />
        <div className="hero-float-a pointer-events-none absolute -bottom-40 -left-32 w-[520px] h-[520px] rounded-full border-[70px] border-white/[0.05]" />
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-gold-400 to-transparent z-10" />

        <div className="relative z-10 max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-32 sm:pt-40 pb-20 grid grid-cols-1 lg:grid-cols-[0.95fr_1.05fr] gap-14 lg:gap-8 items-center">
          <div className="max-w-2xl">
            <div className="hero-rise flex items-center gap-3 mb-7">
              <div className="h-px w-14 bg-gold-400" />
              <span className="text-gold-300 text-xs uppercase tracking-[0.3em] font-sans">
                Desde 2010
              </span>
            </div>

            <h1 className="hero-rise hero-d1 hero-titulo text-5xl sm:text-6xl lg:text-7xl text-white mb-7">
              Centro de
              <br />
              <span className="text-gold-400">Mediación</span>
              <br />
              NUMA
            </h1>

            <p className="hero-rise hero-d2 text-lg sm:text-xl text-blue-100 leading-relaxed mb-10 max-w-[24rem]">
              Promovemos el diálogo, la justicia y el entendimiento entre las
              partes.
            </p>

            {/* Un solo botón — Acceso al Sistema y Sedes ya están en el
                menú de arriba, no hace falta repetirlos aquí. */}
            <a
              href="#nosotros"
              className="hero-rise hero-d3 btn-shine inline-flex items-center gap-3 pl-7 pr-2 py-2.5 bg-gold-400 text-numa-950 text-base font-bold rounded-full group hover:bg-gold-300 btn-press shadow-[0_18px_36px_-14px_rgba(224,184,74,0.95)]"
            >
              Conoce más <span className="btn-ico"><ArrowRight className="w-4 h-4" /></span>
            </a>
          </div>

          {/* Portal en arco: el símbolo de la marca enmarca las fotos que rotan */}
          <div className="hero-rise hero-d2 relative mx-auto w-[min(88vw,470px)] lg:w-[min(45vw,580px)]">
            <div
              ref={portalRef}
              onMouseMove={inclinarPortal}
              onMouseLeave={enderezarPortal}
              className="portal relative aspect-[100/117]"
            >
              <span className="portal-aro-a absolute -inset-4 rounded-t-full border border-gold-400/70" />
              <span className="portal-aro-b absolute -inset-9 rounded-t-full border border-white/15" />

              <div className="relative h-full w-full overflow-hidden rounded-t-full rounded-b-[2rem] ring-4 ring-gold-400/90 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)] bg-[#0A2A62]">
                {heroImages.map((img, i) => (
                  <div
                    key={img.src}
                    className={`absolute inset-0 transition-opacity duration-1000 ${
                      i === heroIndex ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    {/* Relleno desenfocado de la misma foto: llena el arco */}
                    <Image
                      src={img.src}
                      alt=""
                      fill
                      aria-hidden="true"
                      sizes="(min-width:1024px) 440px, 80vw"
                      className="object-cover scale-125 blur-2xl opacity-70"
                    />
                    {/* La foto completa, sin recortar, en la parte baja del arco */}
                    <div className="absolute inset-x-0 bottom-0 h-[57.5%] border-t-2 border-gold-400/80">
                      <Image
                        src={img.src}
                        alt={img.alt}
                        fill
                        priority={i === 0}
                        sizes="(min-width:1024px) 440px, 80vw"
                        className={`object-contain ${i === heroIndex ? 'hero-zoom' : ''}`}
                      />
                    </div>
                  </div>
                ))}
                <div className="absolute inset-0 bg-gradient-to-t from-[#071B45]/70 via-transparent to-transparent" />
              </div>

              {/* Indicadores del carrusel (el activo se va llenando hasta el siguiente cambio) */}
              <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-2">
                {heroImages.map((img, i) => (
                  <button
                    key={img.src}
                    type="button"
                    onClick={() => setHeroIndex(i)}
                    aria-label={`Mostrar foto ${i + 1}`}
                    className={`relative overflow-hidden h-1.5 rounded-full transition-all duration-500 ${
                      i === heroIndex ? 'w-10 bg-white/30' : 'w-1.5 bg-white/60 hover:bg-white'
                    }`}
                  >
                    {i === heroIndex && (
                      <span key={heroIndex} className="hero-progress absolute inset-y-0 left-0 rounded-full bg-gold-400" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Flecha que invita a bajar */}
        <a
          href="#numa-pompilio"
          aria-label="Bajar"
          className="hidden sm:flex absolute bottom-6 right-8 z-10 w-11 h-11 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 transition-colors"
        >
          <ChevronDown className="w-5 h-5 hero-bounce" />
        </a>
      </section>

      {/* NUMA POMPILIO — símbolo histórico detrás del nombre del centro.
          Va justo debajo del banner de fotos (antes de "Quiénes somos"),
          como una franja informativa chica — no una sección a página
          completa — con la foto más reducida. */}
      <section id="numa-pompilio" className="py-10 sm:py-12 bg-[#E8EFFA] border-b border-numa-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] gap-6 sm:gap-10 items-center">
            <div className="relative mx-auto sm:mx-0 w-32 sm:w-full rounded-t-full rounded-b-2xl overflow-hidden shadow-[0_30px_50px_-24px_rgba(11,39,89,0.6)] ring-4 ring-gold-400/80">
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

              <p className="text-sm text-numa-600 leading-relaxed justify-es">
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
      <section id="nosotros" className="relative py-14 sm:py-20 bg-glow-white overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-center">
            <div>
              <div className="flex mb-4">
                <span className="inline-block rounded-full border border-gold-400/40 bg-gold-400/10 px-3.5 py-1 text-[11px] uppercase tracking-[0.2em] text-gold-600 font-sans">Quiénes Somos</span>
              </div>

              <h2 className="title-accent text-3xl sm:text-4xl font-bold text-numa-900 mb-6 leading-tight">
                Más de una década construyendo puentes de paz
              </h2>

              <p className="text-numa-600 leading-relaxed mb-6 justify-es">
                El Centro de Mediación NUMA es una institución reconocida en
                Ecuador por su compromiso con la resolución alternativa de
                disputas.
              </p>

              <p className="text-numa-600 leading-relaxed justify-es">
                Contamos con sucursales en las principales ciudades del país y
                hemos facilitado la resolución exitosa de conflictos.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3 sm:gap-4 items-end">
              {[
                { num: '1,000+', label: 'Casos resueltos' },
                { num: '10+', label: 'Años de experiencia' },
                { num: '5', label: 'Sucursales activas' },
                { num: '98%', label: 'Satisfacción de clientes' },
              ].map((stat, i) => (
                <div key={stat.label} className="reveal stat-card" style={{ transitionDelay: `${i * 90}ms` }}>
                  <div
                    className="rounded-t-full rounded-b-2xl bg-gradient-to-b from-[#1B4AAE] via-[#144193] to-[#0A2A62] px-3 pb-6 text-center text-white ring-1 ring-gold-400/50 shadow-[0_28px_44px_-24px_rgba(11,39,89,0.8)]"
                    style={{ paddingTop: ['3.5rem', '5rem', '4.25rem', '6rem'][i] }}
                  >
                    <div className="text-3xl font-extrabold text-gold-300 mb-1.5 tabular-nums whitespace-nowrap" style={{ fontFamily: '"Jost Variable", system-ui, sans-serif' }}>
                      <CifraAnimada texto={stat.num} />
                    </div>
                    <div className="text-xs sm:text-sm text-blue-100 font-sans leading-snug">
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
      <div className="bg-white px-3 sm:px-6 py-2 sm:py-4">
      <section id="misión" className="relative py-9 sm:py-14 bg-gradient-to-br from-[#0A2A62] via-[#144193] to-[#2358C9] overflow-hidden rounded-[1.75rem] sm:rounded-[2.5rem]">
        <div className="hero-float-a pointer-events-none absolute -top-32 -right-20 w-80 h-80 rounded-full border-[40px] border-white/[0.05]" />
        <div className="max-w-5xl mx-auto px-5 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1px_1fr] gap-6 md:gap-12 items-start">
            <div className="reveal">
              <div className="flex items-center gap-3 mb-2.5 sm:mb-4">
                <Scale className="w-6 h-6 text-gold-400" />
                <h2 className="text-sm sm:text-base font-sans font-semibold uppercase tracking-[0.25em] text-gold-400">
                  Misión
                </h2>
              </div>
              <p className="text-lg sm:text-2xl text-white leading-snug">
                Brindar servicios de mediación y resolución alternativa de
                conflictos de alta calidad.
              </p>
            </div>

            <div className="hidden md:block self-stretch w-px bg-gradient-to-b from-transparent via-gold-400/60 to-transparent" />
            <div className="md:hidden h-px bg-gradient-to-r from-transparent via-gold-400/60 to-transparent" />

            <div className="reveal reveal-d1">
              <div className="flex items-center gap-3 mb-2.5 sm:mb-4">
                <Eye className="w-6 h-6 text-gold-400" />
                <h2 className="text-sm sm:text-base font-sans font-semibold uppercase tracking-[0.25em] text-gold-400">
                  Visión
                </h2>
              </div>
              <p className="text-lg sm:text-2xl text-white leading-snug">
                Ser el centro de mediación líder reconocido por su excelencia.
              </p>
            </div>
          </div>
        </div>
      </section>
      </div>

      {/* VALORES */}
      <section id="valores" className="py-14 sm:py-20 bg-aurora aurora-a">
        <Arcos />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <h2 className="title-accent title-accent-center text-3xl sm:text-4xl font-bold text-numa-900">
              Valores Institucionales
            </h2>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 sm:gap-x-6 gap-y-8 sm:gap-y-12">
            {valores.map(({ icon: Icon, titulo, desc }, idx) => (
              <div
                key={titulo}
                className="reveal group valor-card"
                style={{ transitionDelay: `${idx * 70}ms`, marginTop: idx % 2 ? "1.5rem" : undefined }}
              >
                
                <div className="w-14 h-[4.5rem] sm:w-16 sm:h-20 rounded-t-full rounded-b-2xl bg-gradient-to-b from-[#1B4AAE] to-[#0A2A62] ring-2 ring-gold-400/70 flex items-center justify-center mb-4 sm:mb-6 shadow-[0_18px_30px_-16px_rgba(11,39,89,0.8)]">
                  <Icon className="w-6 h-6 text-gold-300" />
                </div>
                <h3 className="text-base sm:text-xl font-bold text-numa-900 mb-1.5 sm:mb-2">{titulo}</h3>
                <p className="text-[13px] sm:text-sm text-numa-700 leading-relaxed font-sans">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BENEFICIOS */}
      <section id="beneficios" className="py-12 sm:py-14 bg-aurora aurora-b">
        <Arcos />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-7">
            <div className="flex justify-center mb-4">
                <span className="inline-block rounded-full border border-gold-400/40 bg-gold-400/10 px-3.5 py-1 text-[11px] uppercase tracking-[0.2em] text-gold-600 font-sans">¿Por qué mediar?</span>
              </div>

            <h2 className="title-accent title-accent-center text-3xl sm:text-4xl font-bold text-numa-900">
              Beneficios de la Mediación
            </h2>
          </div>

          {/* Cada beneficio muestra un resumen recortado con "…" y se
              despliega completo, flotando por encima de las tarjetas
              vecinas, al pasar el mouse (escritorio) o al tocarlo
              (celular, donde no existe el hover). La celda externa tiene
              alto fijo para que al expandirse no se mueva el resto de
              la cuadrícula. */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:max-w-5xl lg:mx-auto">
            {beneficios.map(({ icon: Icon, titulo, desc }) => {
              const abierto = beneficioAbierto === titulo;
              return (
                <div key={titulo} className="relative h-[246px] sm:h-[172px]">
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
                    className={`absolute inset-x-0 top-0 min-h-full p-4 sm:p-5 rounded-3xl border cursor-pointer transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${
                      abierto
                        ? 'z-20 bg-gradient-to-br from-[#144193] to-[#0A2A62] border-gold-400/60 shadow-xl'
                        : 'z-0 bg-white border-numa-100'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-full border flex items-center justify-center mb-3 sm:mb-2.5 transition-colors duration-300 ${
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
                      className={`text-base font-bold mb-1.5 sm:mb-1 transition-colors duration-300 ${
                        abierto ? 'text-gold-400' : 'text-numa-900'
                      }`}
                    >
                      {titulo}
                    </h3>

                    <p
                      className={`text-[13px] leading-relaxed font-sans justify-es transition-colors duration-300 ${
                        abierto ? 'text-numa-100' : 'text-numa-600 line-clamp-4 sm:line-clamp-2'
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
      <section id="servicios" className="py-14 sm:py-20 bg-aurora aurora-c">
        <Arcos />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-center">
            <div>
              <h2 className="title-accent text-3xl sm:text-4xl font-bold text-numa-900 mb-6">
                Nuestros Servicios
              </h2>

              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {servicios.map((s) => (
                  <li key={s} className="servicio-item flex items-center gap-3">
                    <CheckCircle className="w-5 h-5 text-gold-500 shrink-0" />

                    <span className="text-numa-800 font-sans text-sm">
                      {s}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="reveal bezel"><div className="bg-gradient-to-br from-[#0A2A62] via-[#144193] to-[#2358C9] rounded-[1.6rem] p-10 sm:p-12 text-white shadow-soft inner-hl">
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
      <section id="contacto" className="relative overflow-hidden py-14 sm:py-20 bg-gradient-to-br from-[#0A2A62] via-[#144193] to-[#2358C9]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="reveal bezel"><div className="bg-white rounded-[1.6rem] shadow-soft inner-hl-light p-10 sm:p-14">
            <div className="flex justify-center mb-4">
                <span className="inline-block rounded-full border border-gold-400/40 bg-gold-400/10 px-3.5 py-1 text-[11px] uppercase tracking-[0.2em] text-gold-600 font-sans">¿Tienes un conflicto que resolver?</span>
              </div>

            <h2 className="title-accent title-accent-center text-3xl sm:text-4xl font-bold text-numa-900 mb-6">
              Solicita una asesoría gratuita
            </h2>

            <p className="text-numa-600 mb-10 max-w-xl mx-auto leading-relaxed">
              Cuéntanos tu caso y te orientamos sobre cómo resolverlo a través
              de mediación, en el menor tiempo posible.
            </p>

            <div className="flex flex-wrap justify-center gap-3 sm:gap-4 font-ui">
              <a
                href="https://wa.me/593981790092?text=Hola%2C%20quisiera%20una%20asesor%C3%ADa%20gratuita%20sobre%20mi%20caso"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-shine inline-flex items-center gap-2 px-6 py-3 bg-green-500 text-white text-sm font-semibold rounded-full hover:bg-green-600 btn-press"
              >
                <WhatsAppIcon className="w-4 h-4" />
                Escríbenos por WhatsApp
              </a>

              <a
                href="https://www.facebook.com/profile.php?id=61594906720744"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-shine inline-flex items-center gap-2 px-6 py-3 bg-[#1877F2] text-white text-sm font-semibold rounded-full hover:bg-[#1465d6] btn-press"
              >
                <FacebookIcon className="w-4 h-4" />
                Síguenos en Facebook
              </a>

              <a
                href="mailto:numacentromediacion@gmail.com"
                className="inline-flex items-center gap-2 px-6 py-3 border border-numa-300 text-numa-700 text-sm font-medium rounded-full hover:border-gold-500 hover:text-gold-600 btn-press"
              >
                <Mail className="w-4 h-4" />
                Escríbenos un correo
              </a>
            </div>

            <div className="mt-8 pt-6 border-t border-numa-100 text-left">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-xl font-bold text-numa-900 mb-1">Visítanos</h3>
                  <p className="text-sm text-numa-600 font-sans">Av. Tulcán y Calle Machala, Santo Domingo, Ecuador</p>
                </div>
                <a
                  href="https://www.google.com/maps/search/?api=1&query=-0.2527971%2C-79.1692147"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 self-start sm:self-auto px-5 py-2.5 bg-[#144193] text-white text-sm font-semibold rounded-full hover:bg-[#1B4AAE] btn-press whitespace-nowrap font-sans"
                >
                  <MapPin className="w-4 h-4 text-gold-400" />
                  Cómo llegar
                </a>
              </div>
              <div className="overflow-hidden rounded-2xl ring-1 ring-numa-100 bg-numa-50">
                <iframe
                  title="Ubicación del Centro de Mediación NUMA"
                  src="https://www.google.com/maps?q=-0.2527971,-79.1692147&hl=es&z=18&output=embed"
                  className="block w-full h-[170px] sm:h-[210px] border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                />
              </div>
            </div>
          </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="acceso" className="relative overflow-hidden py-14 bg-gradient-to-br from-gold-300 via-gold-400 to-gold-500">
        <div className="hero-float-a pointer-events-none absolute -top-24 -left-16 w-72 h-72 rounded-full border-[36px] border-white/20" />
        <div className="hero-float-b pointer-events-none absolute -bottom-28 -right-10 w-80 h-80 rounded-full border-[40px] border-numa-950/10" />
        <div className="relative max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-numa-950 mb-4">
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
        className="wa-pulse fixed bottom-6 right-6 z-50 w-14 h-14 bg-green-500 hover:bg-green-600 rounded-full shadow-2xl flex items-center justify-center btn-press"
        aria-label="Escríbenos por WhatsApp"
      >
        <WhatsAppIcon className="w-7 h-7 text-white" />
      </a>
    </div>
  );
}