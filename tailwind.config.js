import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: { extend: {} },
  plugins: [tailwindcssAnimate]
};