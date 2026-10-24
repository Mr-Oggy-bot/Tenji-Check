import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#08131c", 900: "#0b1d2a", 800: "#12293a", 700: "#1d3a50", 600: "#2c4f68" },
        teal: { 50: "#e8f8f4", 100: "#c7eee3", 400: "#2fc2a0", 500: "#16a885", 600: "#0f8a6d", 700: "#0d6e58" },
        tactile: { 400: "#f2c230", 500: "#e8ad12", 600: "#c48f06" },
        // Soft-grey surfaces and the volt accent of the shell / home / new pages.
        mist: { 50: "#f4f5f6", 100: "#e9ebed", 200: "#d9dce0", 300: "#c3c7cc", 400: "#9fa4ab", 500: "#7c8189", 600: "#5d6269", 700: "#464a50", 800: "#33363a", 900: "#26292c" },
        volt: { 200: "#fafbb0", 300: "#f6f86a", 400: "#eef21a", 500: "#d6da00" },
        // Formal portal blue (primary actions, active navigation, headers)
        gov: { 50: "#eef4fc", 100: "#dbe7f9", 200: "#b9d0f2", 300: "#8bb2e8", 400: "#4f89d8", 500: "#1f68c9", 600: "#0b5cbf", 700: "#084c9f", 800: "#073d80", 900: "#062f62" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        display: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: { "4xl": "1.75rem" },
      boxShadow: {
        card: "0 1px 2px rgba(8,19,28,.06), 0 4px 16px rgba(8,19,28,.06)",
        soft: "0 1px 2px rgba(15,35,70,.05), 0 6px 20px -6px rgba(15,35,70,.14)",
      },
    },
  },
  plugins: [],
} satisfies Config;
