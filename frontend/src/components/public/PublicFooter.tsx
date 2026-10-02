import { Mail, Phone, MapPin, Lock } from 'lucide-react';
import WhatsAppIcon from '@/components/icons/WhatsAppIcon';
import RotatingLogo from '@/components/public/RotatingLogo';
import Link from 'next/link';

export default function PublicFooter() {
  return (
<footer
  id="contacto-footer"
  className="bg-[#0B141C] text-white border-t border-numa-900"
>      
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          
          {/* Brand */}
          <div className="md:col-span-2">
            <Link href="/" className="inline-block mb-5">
              <RotatingLogo className="h-14 w-44" />
            </Link>

            <p className="text-sm leading-relaxed max-w-sm text-white">
              Promovemos la resolución pacífica de conflictos a través del diálogo,
              la justicia y el entendimiento mutuo.
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="text-white text-sm font-semibold uppercase tracking-wider mb-4">
              Institución
            </h4>

            <ul className="space-y-3">
              {[
                { label: 'Nosotros', href: '/#nosotros' },
                { label: 'Misión y Visión', href: '/#misión' },
                { label: 'Valores', href: '/#valores' },
                { label: 'Servicios', href: '/#servicios' },
                { label: 'Contacto', href: '/#contacto' },
              ].map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    className="text-sm hover:text-gold-400 transition-colors"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-white text-sm font-semibold uppercase tracking-wider mb-4">
              Contacto Oficina Matriz
            </h4>

            <ul className="space-y-4">
              <li className="flex items-start gap-3 text-sm">
                <MapPin className="w-4 h-4 mt-0.5 text-gold-400 shrink-0" />

                <span>
                  Av. Tulcán y Calle Machala,
                  <br />
                  Santo Domingo - Ecuador
                </span>
              </li>

              <li className="flex items-center gap-3 text-sm">
                <Phone className="w-4 h-4 text-gold-400 shrink-0" />

                <span className="text-white">
                  0981790092
                </span>
              </li>

              <li className="flex items-center gap-3 text-sm">
                <WhatsAppIcon className="w-4 h-4 text-gold-400 shrink-0" />

                <a
                  href="https://wa.me/593981790092?text=Hola%2C%20quisiera%20informaci%C3%B3n%20sobre%20mediaci%C3%B3n"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-green-400 transition-colors"
                >
                  WhatsApp
                </a>
              </li>

              <li className="flex items-center gap-3 text-sm">
                <Mail className="w-4 h-4 text-gold-400 shrink-0" />

                <span className="text-white">
                  numamediacionec@hotmail.com
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Aviso de privacidad: antes era un link pequeño y casi no se veía.
            Ahora es un botón propio, con ícono y color dorado, para que no
            pase desapercibido — el contenido que protege es importante. */}
        <div className="border-t border-numa-800 mt-12 pt-6 flex flex-col sm:flex-row items-center justify-center">
          <Link
            href="/aviso-privacidad"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-gold-400/60 text-gold-400 text-sm font-semibold hover:bg-gold-400 hover:text-numa-950 transition-colors"
          >
            <Lock className="w-4 h-4" />
            Aviso de Privacidad
          </Link>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-white">
            © {new Date().getFullYear()} Centro de Mediación NUMA.
            Todos los derechos reservados.
          </p>

          <Link
            href="/login"
            className="text-xs text-gold-400 hover:text-gold-500 transition-colors"
          >
            Acceso al Sistema →
          </Link>
        </div>
      </div>
    </footer>
  );
}