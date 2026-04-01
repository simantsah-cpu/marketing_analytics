/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'blue-primary': '#0F5FA6',
        'blue-mid': '#1A7FD4',
        'blue-light': '#DBEAFE',
        'brand-teal': '#0D8A72',
        'brand-red': '#C0392B',
        'brand-amber': '#D97706',
        'navy': '#0A2540',
        'subtext': '#5A6A7A',
        'border-color': '#E2EAF0',
        'bg-page': '#F5F8FB',
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      fontSize: {
        'kpi': '30px',
        'kpi-label': '11px',
        'chart-title': '13px',
      },
      borderRadius: {
        'card': '12px',
      },
    },
  },
  plugins: [],
}
