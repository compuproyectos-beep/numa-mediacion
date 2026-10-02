'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Menu, X, ChevronDown, Phone, Mail, MapPin } from 'lucide-react';
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';
import RotatingLogo from '@/components/public/RotatingLogo';
import api from '@/lib/api';

export default function PublicNavbar() {
  const [open, setOpen] = useState(false);
  const [sedes, setSedes] = useState<any[]>([]);
  const [openSedes, setOpenSedes] = useState(false);
  // Arriba del todo (sobre el banner de fotos) el menú va claro, con letras
  // azules; apenas se hace scroll pasa a oscuro con letras blancas, como
  // estaba antes. Así no se siente todo "un bloque azul" desde el inicio.
  const [scrolled, setScrolled] = useState(false);

  const sedesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get('/sedes')
      .then((res) => setSedes(res.data))
      .catch(() => setSedes([]));
  }, []);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 40);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        sedesRef.current &&
        !sedesRef.current.contains(event.target as Node)
      ) {
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
    <nav
      className={`fixed top-0 left-0 right-0 z-50 backdrop-blur-sm border-b transition-colors duration-300 ${
        scrolled
          ? 'bg-numa-950/95 border-numa-800'
          : 'bg-white/95 border-numa-100'
      }`}
    >
      {/* Barra de contacto — siempre visible, sin necesidad de bajar hasta el pie de página */}
      <div
        className={`hidden sm:block border-b transition-colors duration-300 ${
          scrolled ? 'bg-numa-900 border-numa-800' : 'bg-numa-50 border-numa-100'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div
            className={`flex items-center justify-between h-12 text-sm transition-colors duration-300 ${
              scrolled ? 'text-white' : 'text-numa-800'
            }`}
          >
            <div className="flex items-center gap-7">
              <span className="flex items-center gap-2">
                <Phone className="w-4 h-4" />
                0981790092
              </span>

              <span className="flex items-center gap-2">
                <Mail className="w-4 h-4" />
                numamediacionec@hotmail.com
              </span>
            </div>

            <a
              href="https://wa.me/593981790092?text=Hola%2C%20quisiera%20informaci%C3%B3n%20sobre%20mediaci%C3%B3n"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-green-600 hover:text-green-500 transition-colors font-medium"
            >
              <WhatsAppIcon className="w-4 h-4" />
              WhatsApp
            </a>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          <Link href="/" className="flex items-center">
            {/* Mientras el navbar es blanco, el logo (que trae fondos oscuros
                en 2 de sus 3 variantes) va sobre un chip oscuro para que
                siempre se lea bien, sin importar cuál variante esté activa. */}
            <span
              className={`inline-flex items-center rounded-sm transition-colors duration-300 ${
                scrolled ? '' : 'bg-numa-950 p-1.5'
              }`}
            >
              <RotatingLogo className="h-14 w-40 sm:h-16 sm:w-48" />
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            {['Nosotros', 'Misión', 'Valores', 'Servicios', 'Contacto'].map(
              (item) => (
                <a
                  key={item}
                  href={`/#${item.toLowerCase()}`}
                  className={`text-sm transition-colors duration-200 tracking-wide hover:text-gold-500 ${
                    scrolled ? 'text-white hover:text-gold-400' : 'text-numa-800'
                  }`}
                >
                  {item}
                </a>
              )
            )}
          </div>

          <div className="hidden md:flex items-center gap-4">
            <div ref={sedesRef} className="relative">
              <button
                type="button"
                onClick={() => setOpenSedes((prev) => !prev)}
                className={`px-5 py-2 text-sm font-medium rounded-sm transition-colors duration-200 tracking-wide inline-flex items-center gap-1 border ${
                  scrolled
                    ? 'text-white border-white/20 hover:border-gold-400 hover:text-gold-400'
                    : 'text-numa-800 border-numa-200 hover:border-gold-500 hover:text-gold-600'
                }`}
              >
                Sedes
                <ChevronDown className="w-4 h-4" />
              </button>

              {openSedes && (
                <div className="absolute top-full right-0 mt-3 w-72 max-h-80 overflow-y-auto bg-white border border-numa-100 shadow-2xl rounded-md z-[9999]">
                  <div className="px-4 py-3 bg-numa-50 border-b border-numa-100 sticky top-0">
                    <span className="text-xs font-semibold uppercase tracking-wider text-numa-500">
                      Nuestras sedes
                    </span>
                  </div>

                  <div className="divide-y divide-numa-100">
                    {sedes.length === 0 ? (
                      <div className="px-4 py-6 text-sm text-numa-500 text-center">
                        No hay sedes disponibles
                      </div>
                    ) : (
                      Object.entries(sedesPorProvincia).map(([provincia, ciudades]) => (
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
                                  onClick={() => setOpenSedes(false)}
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
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <Link
              href="/login"
              className="px-5 py-2 text-sm font-medium text-numa-950 bg-gold-400 rounded-sm hover:bg-gold-500 transition-colors duration-200 tracking-wide"
            >
              Acceso al Sistema
            </Link>
          </div>

          <button
            onClick={() => setOpen((prev) => !prev)}
            className={`md:hidden p-2 hover:text-gold-400 transition-colors duration-200 ${
              scrolled ? 'text-white' : 'text-numa-800'
            }`}
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div
          className={`md:hidden border-t px-4 pb-4 pt-2 space-y-2 transition-colors duration-300 ${
            scrolled
              ? 'bg-numa-950 border-numa-800'
              : 'bg-white border-numa-100'
          }`}
        >
          {['Nosotros', 'Misión', 'Valores', 'Servicios', 'Contacto'].map(
            (item) => (
              <a
                key={item}
                href={`/#${item.toLowerCase()}`}
                onClick={() => setOpen(false)}
                className={`block py-2 text-sm hover:text-gold-400 ${
                  scrolled ? 'text-white' : 'text-numa-800'
                }`}
              >
                {item}
              </a>
            )
          )}

          <button
            type="button"
            onClick={() => setOpenSedes((prev) => !prev)}
            className={`w-full flex items-center justify-between py-2 text-sm hover:text-gold-400 ${
              scrolled ? 'text-white' : 'text-numa-800'
            }`}
          >
            Sedes
            <ChevronDown className="w-4 h-4" />
          </button>

          {openSedes && (
            <div className="max-h-64 overflow-y-auto bg-white rounded-md border border-numa-100 divide-y divide-numa-100">
              {sedes.length === 0 ? (
                <div className="px-4 py-4 text-sm text-numa-500 text-center">
                  No hay sedes disponibles
                </div>
              ) : (
                Object.entries(sedesPorProvincia).map(([provincia, ciudades]) => (
                  <div key={provincia}>
                    <div className="px-4 pt-2.5 pb-1 bg-numa-50/70">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-numa-700">
                        {provincia}
                      </span>
                    </div>

                    {Object.entries(ciudades).map(([ciudad, listaSedes]) => (
                      <div key={ciudad}>
                        <div className="px-5 pt-1.5 pb-1">
                          <span className="text-[11px] font-medium text-numa-400 uppercase tracking-wide">
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
                            className="flex items-center gap-3 pl-7 pr-4 py-2.5 hover:bg-gold-50"
                          >
                            <MapPin className="w-3.5 h-3.5 text-numa-400 shrink-0" />

                            <span className="block text-sm font-semibold text-numa-900 truncate">
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

          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="block mt-3 py-2.5 text-center text-sm font-medium text-numa-950 bg-gold-400 rounded-sm"
          >
            Acceso al Sistema
          </Link>
        </div>
      )}
    </nav>
  );
}