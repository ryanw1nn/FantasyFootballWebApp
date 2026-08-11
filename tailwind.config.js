import colors from 'tailwindcss/colors'

/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
      extend: {
        colors: {
          // Single accent color for the whole app — change here to re-theme everything.
          accent: colors.indigo,
        },
      },
    },
    plugins: [],
  }