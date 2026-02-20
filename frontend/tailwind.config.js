/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
        display: ['"Barlow Condensed"', 'sans-serif'],
      },
      colors: {
        base: {
          950: '#050505',
          900: '#0d0d0d',
          800: '#141414',
          700: '#242424',
          600: '#444444',
          500: '#888888',
          400: '#aaaaaa',
          300: '#c8c8c8',
          200: '#dedede',
          100: '#eeeeee',
          50:  '#f8f8f8',
        },
        accent: '#00c8f0',
        danger: '#ff3b3b',
        warn:   '#e8a000',
        ok:     '#22c55e',
      },
      borderColor: {
        subtle: 'rgba(255,255,255,0.07)',
        faint:  'rgba(255,255,255,0.04)',
      },
    },
  },
  plugins: [],
}
