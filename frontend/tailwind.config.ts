import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Deep, professional blue — the classic legal/institutional color
        // (courts, law schools, bar associations). Cool and crisp, not a
        // washed-out corporate blue: enough contrast between steps to stay
        // legible and lively rather than flat.
        numa: {
          50:  '#F3F6FA',
          100: '#E4EBF3',
          200: '#C9D6E5',
          300: '#9FB4CE',
          400: '#6D89AC',
          500: '#4A6789',
          600: '#34506F',
          700: '#23405B',
          800: '#16324A',
          900: '#0E2338',
          950: '#081524',
        },
        // A brighter, more visible gold — a seal/medal, not a faded plaque.
        // Placed against the blue, it's what keeps the palette from
        // feeling monotone.
        gold: {
          400: '#E0B84A',
          500: '#C99A2E',
          600: '#A67B1F',
        }
      },
      fontFamily: {
        // A more literary serif stack (no external font needed): falls back
        // gracefully through distinctive system serifs before Georgia.
        display: ['Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', 'Georgia', 'Cambria', 'serif'],
        // Tipografía institucional de la página pública (se descarga junto con el sitio, se ve igual en todos los equipos).
        brand: ['"Newsreader Variable"', 'Iowan Old Style', 'Palatino Linotype', 'Georgia', 'serif'],
        ui: ['"Jost Variable"', 'system-ui', 'Segoe UI', 'sans-serif'],
        body: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // Used sparingly for fixed-width identifiers: cédulas, códigos de acta/proceso.
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.4s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
export default config
