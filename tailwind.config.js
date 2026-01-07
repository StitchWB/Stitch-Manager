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
        // Deep Space Theme
        primary: "#6366f1", // Electric Indigo
        accent: "#06b6d4", // Neon Cyan
        
        // Background layers (rich slates, not flat black)
        "ds-bg": "#020617", // slate-950
        "ds-surface": "#0f172a", // slate-900
        "ds-panel": "#1e293b", // slate-800
        "ds-elevated": "#334155", // slate-700
        
        // Legacy aliases for compatibility
        "background-dark": "#020617",
        "surface-dark": "#0f172a",
        "border-dark": "rgba(255, 255, 255, 0.1)",
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }], // 10px
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(99, 102, 241, 0.3)' },
          '100%': { boxShadow: '0 0 20px rgba(99, 102, 241, 0.6)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'glow-sm': '0 0 10px -3px rgba(99, 102, 241, 0.3)',
        'glow': '0 0 20px -5px rgba(99, 102, 241, 0.4)',
        'glow-lg': '0 0 30px -5px rgba(99, 102, 241, 0.5)',
        'inner-glow': 'inset 0 0 20px -10px rgba(99, 102, 241, 0.3)',
      },
    },
  },
  plugins: [],
}
