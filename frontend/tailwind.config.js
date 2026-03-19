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
                // primary stays hardcoded — black accent works on any background
                primary: {
                    DEFAULT: '#09090B',
                },
                // semantic tokens driven by CSS variables — swap automatically on .dark
                secondary: 'var(--color-secondary)',
                bg:        'var(--color-bg)',
                fg:        'var(--color-fg)',
                surface:   'var(--color-surface)',
                border:    'var(--color-border)',
            },
            fontFamily: {
                sans: ['"Fira Sans"', 'system-ui', 'sans-serif'],
                mono: ['"Fira Code"', 'monospace'],
            }
        },
    },
    plugins: [],
}
