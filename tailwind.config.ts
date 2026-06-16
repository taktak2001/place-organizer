import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#303841",
        moss: "#76ABAE",
        clay: "#FF5722",
        paper: "#F5F5F5",
        surface: "#FFFFFF",
        muted: "rgba(48, 56, 65, 0.68)",
        line: "rgba(48, 56, 65, 0.14)",
        accentSoft: "#E8F3F3",
        warningSoft: "#FFF0EB"
      }
    }
  },
  plugins: []
};

export default config;
