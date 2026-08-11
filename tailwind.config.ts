import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        rimal: {
          purple: {
            DEFAULT: "#734f96",
            light: "#9a76bb",
            dark: "#4f3569",
            50: "#f6f2fa",
            100: "#ede4f3",
            200: "#d9c7e6",
            300: "#bfa2d4",
            400: "#a37fc0",
            500: "#734f96",
            600: "#5f4079",
            700: "#4f3569",
            800: "#3c2850",
            900: "#291c37",
          },
          // سلّم اللون البرتقالي مأخوذ من لوحة الهوية البصرية المعتمدة (اللون
          // الأساسي #eda155). استُبدل التدرّج السابق الذي كان أساسه #f76c3c —
          // برتقالي محترق أغمق وأكثر تشبّعاً من المعتمد في الهوية.
          orange: {
            DEFAULT: "#eda155",
            light: "#f3c08e",
            dark: "#be8144",
            50: "#fcefe3",
            100: "#f9e9c6",
            200: "#f6d0aa",
            300: "#f3c08e",
            400: "#f0b171",
            500: "#eda155",
            600: "#be8144",
            700: "#8e6133",
            800: "#5f4022",
            900: "#2f2011",
          },
        },
        // ألوان خريطة المقر التفاعلية (InteractiveFloorMap) — درجات ثابتة معتمدة من الهوية البصرية
        floor: {
          bg: "#E8E2ED", // خلفية الخريطة والمحيط العام
          occupied: "#8A6CA8", // مساحات ومقاعد محجوزة حالياً
          available: "#F3CD8E", // مساحات ومقاعد متاحة للحجز
          facility: "#FA9D7D", // مرافق وعناصر ديكورية غير قابلة للحجز
          alert: "#DC2626", // تنبيه أحمر صريح: تبقّى 30 دقيقة أو أقل من وقت الحجز
        },
      },
      fontFamily: {
        sans: ["var(--font-tajawal)", "Tajawal", "Arial", "sans-serif"],
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
