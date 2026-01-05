/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: "#3888ff",
        "background-dark": "#0f1723",
        "surface-dark": "#1e293b",
        "border-dark": "#334155",
      },
    },
  },
  plugins: [],
}
