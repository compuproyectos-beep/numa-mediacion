import PublicNavbar from '@/components/public/PublicNavbar';
import PublicFooter from '@/components/public/PublicFooter';

export default function AvisoPrivacidadPage() {
  return (
    <div className="min-h-screen bg-white font-display">
      <PublicNavbar />

      <section className="relative pt-40 sm:pt-48 pb-24 bg-white overflow-hidden">
        {/* Formas azules decorativas */}
        <div className="absolute -bottom-40 -left-24 w-96 h-96 bg-numa-50 rounded-full blur-3xl opacity-90" />
        <div className="absolute top-1/3 right-1/4 w-64 h-64 bg-gold-400/10 rounded-full blur-3xl" />

        {/* Patrón sutil */}
        <div className="absolute inset-0 opacity-[0.08] pointer-events-none">
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

        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 mb-6">
            <div className="h-px w-12 bg-gold-500" />
            <span className="text-gold-600 text-xs uppercase tracking-[0.3em]">
              Centro de Mediación NUMA
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold text-numa-900 leading-tight mb-3">
            Aviso de Privacidad y Protección de Datos (LOPDP)
          </h1>

          <p className="text-numa-400 text-sm mb-12">
            Última actualización: 4 de octubre de 2026
          </p>

          <div className="space-y-10 text-numa-700 leading-relaxed">
            <div className="bg-gold-50 border-l-4 border-gold-400 rounded-r-sm p-5 text-sm text-numa-600">
              Este aviso describe qué datos personales recolecta el Centro de
              Mediación NUMA, para qué los usa, y cómo puedes ejercer tus
              derechos sobre ellos, de acuerdo con la Ley Orgánica de
              Protección de Datos Personales (LOPDP) de Ecuador.
            </div>

            <section>
              <h2 className="text-xl font-bold text-numa-900 mb-3">
                1. Responsable del tratamiento de datos
              </h2>
              <p>
                <strong className="text-numa-900">Centro de Mediación NUMA</strong>
                <br />
                Dirección: Av. Tulcán y Calle Machala, Santo Domingo, Ecuador
                <br />
                Correo de contacto: numamediacionec@hotmail.com
                <br />
                Teléfono: 0981790092
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-numa-900 mb-3">
                2. ¿Qué datos personales recolectamos?
              </h2>
              <p className="mb-3">
                Dependiendo de tu relación con NUMA (cliente, parte de un
                proceso de mediación, o usuario del sistema), podemos
                recolectar:
              </p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>
                  <strong className="text-numa-800">Datos de identificación:</strong>{' '}
                  nombres, apellidos, número de cédula.
                </li>
                <li>
                  <strong className="text-numa-800">Datos de contacto:</strong>{' '}
                  correo electrónico, número de teléfono, dirección.
                </li>
                <li>
                  <strong className="text-numa-800">Datos del proceso de mediación:</strong>{' '}
                  tema o descripción del conflicto, fechas de citas, resultados
                  y acuerdos alcanzados, actas generadas.
                </li>
                <li>
                  <strong className="text-numa-800">Datos de usuarios del sistema</strong>{' '}
                  (mediadores y personal administrativo): correo, rol, sucursal
                  asignada.
                </li>
              </ul>
              <p className="mt-3 text-sm text-numa-500">
                Algunos procesos de mediación pueden, según su naturaleza,
                involucrar categorías de datos considerados sensibles por la
                LOPDP. En esos casos, tratamos esa información con medidas de
                protección reforzadas y solo para los fines estrictamente
                necesarios del proceso.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-numa-900 mb-3">
                3. ¿Para qué usamos tus datos?
              </h2>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Gestionar tu proceso de mediación de principio a fin (registro, citas, seguimiento, actas finales).</li>
                <li>Contactarte para coordinar citas o notificarte sobre el estado de tu proceso.</li>
                <li>Cumplir con nuestras obligaciones legales como centro de mediación.</li>
                <li>Mantener la seguridad y el correcto funcionamiento de nuestro sistema.</li>
              </ul>
              <p className="mt-3">
                No usamos tus datos con fines publicitarios ni los vendemos a
                terceros.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-numa-900 mb-3">
                4. Base legal del tratamiento
              </h2>
              <p>Tratamos tus datos con base en:</p>
              <ul className="list-disc pl-6 space-y-1.5 mt-2">
                <li>Tu <strong className="text-numa-800">consentimiento</strong>, al iniciar un proceso de mediación con nosotros.</li>
                <li>La <strong className="text-numa-800">ejecución del servicio de mediación</strong> que solicitaste.</li>
                <li>El <strong className="text-numa-800">cumplimiento de obligaciones legales</strong> aplicables a los centros de mediación en Ecuador.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-numa-900 mb-3">
                5. ¿Con quién compartimos tus datos?
              </h2>
              <p className="mb-3">
                No compartimos tus datos personales con terceros para fines
                comerciales. Podemos compartir información únicamente cuando:
              </p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Sea requerido por una autoridad competente (por ejemplo, la Fiscalía, en el marco de un proceso legal).</li>
                <li>Sea necesario para el funcionamiento técnico de nuestro sistema (por ejemplo, el proveedor de almacenamiento en la nube que resguarda los documentos), bajo acuerdos de confidencialidad.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-numa-900 mb-3">
                6. ¿Por cuánto tiempo guardamos tus datos?
              </h2>
              <p>
                Conservamos tus datos personales mientras dure tu proceso de
                mediación y por el tiempo adicional que exija la ley para
                fines de archivo legal de actas y expedientes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-numa-900 mb-3">
                7. Tus derechos sobre tus datos
              </h2>
              <p className="mb-3">
                Como titular de tus datos personales, tienes derecho a:
              </p>
              <ul className="list-disc pl-6 space-y-1.5">
                <li><strong className="text-numa-800">Acceder</strong> a los datos que tenemos sobre ti.</li>
                <li><strong className="text-numa-800">Rectificar</strong> datos inexactos o desactualizados.</li>
                <li><strong className="text-numa-800">Eliminar</strong> tus datos, cuando la ley lo permita.</li>
                <li><strong className="text-numa-800">Oponerte</strong> a un uso específico de tus datos.</li>
                <li><strong className="text-numa-800">Portabilidad</strong>, es decir, solicitar tus datos en un formato reutilizable.</li>
                <li><strong className="text-numa-800">Limitar</strong> el tratamiento de tus datos en ciertas circunstancias.</li>
              </ul>
              <p className="mt-3">
                Para ejercer cualquiera de estos derechos, escríbenos a{' '}
                <a href="mailto:numamediacionec@hotmail.com" className="text-gold-600 underline hover:text-gold-700">
                  numamediacionec@hotmail.com
                </a>
                . Responderemos tu solicitud dentro de los diez (10) días
                establecidos por la ley.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-numa-900 mb-3">
                8. Seguridad de tus datos
              </h2>
              <p>
                Aplicamos medidas técnicas y organizativas para proteger tu
                información, entre ellas: contraseñas cifradas, comunicación
                segura (HTTPS), control de acceso según el rol de cada usuario
                del sistema, y límites ante intentos de acceso no autorizado.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-numa-900 mb-3">
                9. Cambios a este aviso
              </h2>
              <p>
                Podemos actualizar este aviso de privacidad periódicamente. La
                fecha de la última actualización aparece al inicio de este
                documento.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-numa-900 mb-3">
                10. Contacto
              </h2>
              <p>
                Si tienes preguntas sobre este aviso o sobre cómo tratamos tus
                datos personales, contáctanos a:
                <br />
                <a href="mailto:numamediacionec@hotmail.com" className="text-gold-600 underline hover:text-gold-700">
                  numamediacionec@hotmail.com
                </a>
                <br />
                0981790092
              </p>
            </section>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
