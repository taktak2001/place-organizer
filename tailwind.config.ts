import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1e2420",
        moss: "#42624a",
        clay: "#b6654f",
        paper: "#f7f4ed"
      }
    }
  },
  plugins: []
};

export default config;
