'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Menu, X, ChevronDown, Phone, Mail, MapPin } from 'lucide-react';
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';
import FacebookIcon from '@/components/icons/FacebookIcon';
import RotatingLogo from '@/components/public/RotatingLogo';
import api from '@/lib/api';

export default function PublicNavbar() {
  const [open, setOpen] = useState(false);
  const [sedes, setSedes] = useState<any[]>([]);
  const [openSedes, setOpenSedes] = useState(false);
  // Al bajar, la franja de contacto se esconde y queda solo el menú, para no
  // quitar espacio de lectura en pantallas bajitas.
  const [bajo, setBajo] = useState(false);

  useEffect(() => {
    const alScroll = () => setBajo(window.scrollY > 40);
    alScroll();
    window.addEventListener('scroll', alScroll, { passive: true });
    return () => window.removeEventListener('scroll', alScroll);
  }, []);

  const sedesRef = useRef<HTMLDivElement>(null);
  // La lista de sedes del menú móvil vive en otro bloque del DOM que la de
  // escritorio. Sin esta segunda referencia, el cierre "al tocar fuera"
  // trataba el primer toque sobre una sede del celular como un toque
  // afuera: cerraba la lista antes de que el enlace recibiera el clic, y
  // por eso en Android tocar una sede no abría nada.
  const sedesMovilRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get('/sedes')
      .then((res) => setSedes(res.data))
      .catch(() => setSedes([]));
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const destino = event.target as Node;
      const dentroEscritorio = sedesRef.current?.contains(destino);
      const dentroMovil = sedesMovilRef.current?.contains(destino);

      if (!dentroEscritorio && !dentroMovil) {
        setOpenSedes(false);
      }
    };

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenSedes(false);
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  // Mismo agrupamiento Provincia → Ciudad → Sucursal que en el desplegable
  // del hero, para que no haya dos formas distintas de mostrar las sedes.
  // El backend ya entrega la lista ordenada en ese orden.
  const sedesPorProvincia = sedes.reduce((acc: Record<string, Record<string, any[]>>, sede: any) => {
    const provincia = sede.provincia || 'Otras';
    const ciudad = sede.ciudad || 'Sin ciudad';

    if (!acc[provincia]) acc[provincia] = {};
    if (!acc[provincia][ciudad]) acc[provincia][ciudad] = [];
    acc[provincia][ciudad].push(sede);

    return acc;
  }, {});

  return (
    <nav className="fixed top-0 inset-x-0 z-50 px-3 sm:px-6 pointer-events-none font-ui antialiased">
      <div className="pointer-events-auto mx-auto mt-2 sm:mt-3 max-w-6xl rounded-[1.75rem] bg-[#0B141C] backdrop-blur-xl ring-1 ring-white/10 shadow-[0_24px_50px_-24px_rgba(0,0,0,0.7)] transition-shadow">
      {/* Barra de contacto — siempre visible, sin necesidad de bajar hasta el pie de página */}
      <div
        className={`hidden sm:block bg-[#101D28]/80 border-numa-800 overflow-hidden rounded-t-[1.75rem] transition-all duration-300 ${
          bajo ? 'max-h-0 border-b-0' : 'max-h-12 border-b'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-12 text-sm text-white">
            <div className="flex items-center gap-4 md:gap-7">
              <span className="flex items-center gap-2 text-white">
                <Phone className="w-4 h-4" />
                0981790092
              </span>

              <span className="hidden lg:flex items-center gap-2 text-white">
                <Mail className="w-4 h-4" />
                numacentromediacion@gmail.com
              </span>
            </div>

            <div className="flex items-center gap-6">
              <a
                href="https://www.facebook.com/profile.php?id=61594906720744"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-white hover:text-gold-400 transition-colors font-medium"
              >
                <FacebookIcon className="w-4 h-4" />
                Facebook
              </a>

              <a
              href="https://wa.me/593981790092?text=Hola%2C%20quisiera%20informaci%C3%B3n%20sobre%20mediaci%C3%B3n"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-green-400 hover:text-green-300 transition-colors font-medium"
            >
              <WhatsAppIcon className="w-4 h-4" />
              WhatsApp
            </a>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <div className="flex items-center justify-between h-[4.5rem]">
          {/* Logo — a la izquierda en escritorio (posición original) */}
          <Link href="/" className="hidden lg:flex items-center">
            <RotatingLogo className="h-14 w-40 sm:h-16 sm:w-48" />
          </Link>

          {/* En móvil la hamburguesa va a la izquierda (igual que dentro
              del sistema) y el logo queda centrado, con un espacio
              invisible del mismo ancho del botón al otro lado para que el
              logo quede realmente centrado. */}
          <button
            onClick={() => setOpen((prev) => !prev)}
            className="lg:hidden p-2 -ml-2 text-white hover:text-gold-400"
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <Link href="/" className="lg:hidden flex items-center">
            <RotatingLogo className="h-14 w-40 sm:h-16 sm:w-48" />
          </Link>

          <div className="hidden lg:flex items-center gap-8">
            {['Nosotros', 'Misión', 'Valores', 'Servicios', 'Contacto'].map(
              (item) => (
                <a
                  key={item}
                  href={`/#${item.toLowerCase()}`}
                  className="text-sm text-white hover:text-gold-400 transition-colors duration-200 tracking-wide"
                >
                  {item}
                </a>
              )
            )}
          </div>

          <div className="hidden lg:flex items-center gap-4">
            <div ref={sedesRef} className="relative">
              <button
                type="button"
                onClick={() => setOpenSedes((prev) => !prev)}
                className="px-5 py-2 text-sm font-medium text-white border border-white/20 rounded-full hover:border-gold-400 hover:text-gold-400 btn-press tracking-wide inline-flex items-center gap-1"
              >
                Sedes
                <ChevronDown className="w-4 h-4" />
              </button>

              {openSedes && (
                <div className="absolute top-full right-0 mt-4 w-80 max-h-[min(26rem,70vh)] overflow-y-auto overscroll-contain rounded-3xl bg-[#0B141C] ring-1 ring-white/10 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.85)] z-[9999] pb-2">
                  <div className="px-5 py-3.5 bg-[#0B141C]/95 backdrop-blur border-b border-white/10 sticky top-0 z-10">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-400">
                      Nuestras sedes
                    </span>
                  </div>

                  <div className="">
                    {sedes.length === 0 ? (
                      <div className="px-4 py-6 text-sm text-numa-300 text-center">
                        No hay sedes disponibles
                      </div>
                    ) : (
                      Object.entries(sedesPorProvincia).map(([provincia, ciudades]) => (
                        <div key={provincia}>
                          <div className="px-5 pt-5 pb-1">
                            <span className="text-xs font-bold uppercase tracking-[0.18em] text-white">
                              {provincia}
                            </span>
                          </div>

                          {Object.entries(ciudades).map(([ciudad, listaSedes]) => (
                            <div key={ciudad}>
                              <div className="px-5 pt-2.5 pb-1">
                                <span className="text-[11px] font-medium text-numa-300 tracking-wide">
                                  {ciudad}
                                </span>
                              </div>

                              {listaSedes.map((sede: any) => (
                                <Link
                                  key={sede.id}
                                  href={`/sedes/${sede.slug}`}
                                  onClick={() => setOpenSedes(false)}
                                  className="flex items-center gap-3 mx-3 pl-4 pr-3 py-2.5 rounded-xl hover:bg-white/10 transition-colors group"
                                >
                                  <MapPin className="w-3.5 h-3.5 text-gold-400 shrink-0" />

                                  <span className="block text-sm font-semibold text-white group-hover:text-gold-400 transition-colors truncate">
                                    {sede.nombre}
                                  </span>
                                </Link>
                              ))}
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <Link
              href="/login"
              className="px-5 py-2 text-sm font-medium text-numa-950 bg-gold-400 rounded-full hover:bg-gold-500 btn-press tracking-wide"
            >
              Acceso al Sistema
            </Link>
          </div>

          <span className="lg:hidden w-9 h-9" aria-hidden="true" />
        </div>
      </div>

      {open && (
        <div className="lg:hidden border-t border-white/10 px-5 pb-5 pt-2 space-y-2 rounded-b-[1.75rem]">
          {['Nosotros', 'Misión', 'Valores', 'Servicios', 'Contacto'].map(
            (item) => (
              <a
                key={item}
                href={`/#${item.toLowerCase()}`}
                onClick={() => setOpen(false)}
                className="block py-2 text-sm text-white hover:text-gold-400"
              >
                {item}
              </a>
            )
          )}

          <div ref={sedesMovilRef}>
          <button
            type="button"
            onClick={() => setOpenSedes((prev) => !prev)}
            className="w-full flex items-center justify-between py-2 text-sm text-white hover:text-gold-400"
          >
            Sedes
            <ChevronDown className="w-4 h-4" />
          </button>

          {openSedes && (
            <div className="max-h-64 overflow-y-auto overscroll-contain rounded-2xl bg-white/5 ring-1 ring-white/10 pb-2">
              {sedes.length === 0 ? (
                <div className="px-4 py-4 text-sm text-numa-300 text-center">
                  No hay sedes disponibles
                </div>
              ) : (
                Object.entries(sedesPorProvincia).map(([provincia, ciudades]) => (
                  <div key={provincia}>
                    <div className="px-4 pt-3.5 pb-1">
                      <span className="text-xs font-bold uppercase tracking-[0.18em] text-white">
                        {provincia}
                      </span>
                    </div>

                    {Object.entries(ciudades).map(([ciudad, listaSedes]) => (
                      <div key={ciudad}>
                        <div className="px-4 pt-2 pb-1">
                          <span className="text-[11px] font-medium text-numa-300 tracking-wide">
                            {ciudad}
                          </span>
                        </div>

                        {listaSedes.map((sede: any) => (
                          <Link
                            key={sede.id}
                            href={`/sedes/${sede.slug}`}
                            onClick={() => {
                              setOpenSedes(false);
                              setOpen(false);
                            }}
                            className="flex items-center gap-3 mx-2 pl-3 pr-3 py-2.5 rounded-xl hover:bg-white/10"
                          >
                            <MapPin className="w-3.5 h-3.5 text-gold-400 shrink-0" />

                            <span className="block text-sm font-semibold text-white truncate">
                              {sede.nombre}
                            </span>
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
          </div>

          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="block mt-3 py-2.5 text-center text-sm font-medium text-numa-950 bg-gold-400 rounded-full"
          >
            Acceso al Sistema
          </Link>
        </div>
      )}
      </div>
    </nav>
  );
}