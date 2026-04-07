/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#0b1220',
          panel: '#111827',
          grid: '#374151',
          text: '#e5e7eb',
          accent: '#3b82f6',
        },
      },
    },
  },
  plugins: [],
}
