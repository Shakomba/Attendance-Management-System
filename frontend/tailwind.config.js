/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'ui-sans-serif', 'system-ui'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular']
      },
      colors: {
        panel: {
          light: '#f6f8fb',
          dark: '#111827'
        }
      },
      boxShadow: {
        panel: '0 14px 40px rgba(15, 23, 42, 0.14)'
      }
    }
  },
  plugins: []
}
