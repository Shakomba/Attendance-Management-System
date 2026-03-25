/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,jsx,ts,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                primary: {
                    DEFAULT: 'var(--color-primary)',
                    fg:      'var(--color-primary-fg)',
                },
                secondary: 'var(--color-secondary)',
                bg:        'var(--color-bg)',
                card:      'var(--color-card)',
                fg:        'var(--color-fg)',
                surface:   'var(--color-surface)',
                border:    'var(--color-border)',
            },
            fontFamily: {
                sans:    ['Inter', 'system-ui', 'sans-serif'],
                display: ['Outfit', 'system-ui', 'sans-serif'],
                mono:    ['"IBM Plex Mono"', 'monospace'],
            },
        },
    },
    plugins: [],
}
