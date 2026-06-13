/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Live cream surface used across the redesigned (session 17+) UI.
        cream: '#F8F7F5',
        // Legacy "lab" dark palette — retained for the error boundary and any
        // legacy surfaces. Extracted verbatim from the original compiled bundle.
        lab: {
          bg: '#0a0a12',
          surface: '#12121e',
          border: '#1e1e35',
          accent: '#4f8ef7',
          success: '#22c97a',
          warning: '#f5a623',
          danger: '#e64c4c',
          muted: '#5a5a7a',
          text: '#d4d4e8',
          bright: '#ffffff',
        },
      },
      fontFamily: {
        lab: ['"DM Mono"', 'monospace'],
        sans: ['Roboto', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['Georgia', 'Cambria', '"Times New Roman"', 'serif'],
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
      },
      animation: {
        'fade-in': 'fadeIn 0.35s ease-out',
      },
    },
  },
  plugins: [],
};
