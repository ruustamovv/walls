/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#101418',
        muted: '#5b6470',
        line: '#e7e9ee',
        surface: '#ffffff',
        wash: '#f6f7f9',
        primary: '#1a56db',
        playerA: '#1a56db',
        playerB: '#c2410c',
      },
      borderRadius: { xl: '1rem', '2xl': '1.25rem' },
      boxShadow: { card: '0 1px 2px rgba(16,20,24,.06), 0 8px 24px rgba(16,20,24,.06)' },
    },
  },
  plugins: [],
};
