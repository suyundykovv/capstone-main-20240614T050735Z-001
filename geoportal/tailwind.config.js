/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./frontend/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        navy: '#003366',
        teal: '#008080',
        slate: '#0b1a2b',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
};
