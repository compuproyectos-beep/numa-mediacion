import type { Metadata } from 'next';
import '@fontsource-variable/newsreader/index.css';
import '@fontsource-variable/playfair-display/index.css';
import '@fontsource-variable/jost/index.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Centro de Mediación NUMA',
  description: 'Centro de Mediación y Resolución de Conflictos NUMA — Justicia, Diálogo y Paz',
  keywords: ['mediación', 'resolución de conflictos', 'NUMA', 'arbitraje'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Aplica el modo oscuro guardado antes de pintar, solo en el sistema interno (no en la página pública, el login, sedes ni las hojas de impresión). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var p=location.pathname;var publica=/^\\/($|login|olvide-password|restablecer-password|aviso-privacidad|sedes)/.test(p)||/imprimir/.test(p);if(!publica&&localStorage.getItem('sigm-tema')==='oscuro')document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
