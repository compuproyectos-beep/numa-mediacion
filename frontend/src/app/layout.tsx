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
        {/* Aplica el modo oscuro guardado antes de pintar, para que no parpadee. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('sigm-tema')==='oscuro')document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
