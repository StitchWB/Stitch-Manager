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
        // Deep Space Theme - Premium Dark
        'ds-bg': '#050508',             // Deep space background
        'ds-surface': 'rgba(15, 23, 42, 0.5)', // Glassmorphic surface
        'ds-panel': 'rgba(30, 41, 59, 0.4)',   // Panel with transparency
        'ds-input': 'rgba(51, 65, 85, 0.5)',   // Input backgrounds
        'ds-hover': 'rgba(255, 255, 255, 0.03)', // Subtle hover
        'ds-border': 'rgba(255, 255, 255, 0.05)', // Barely visible borders
        'ds-border-light': 'rgba(255, 255, 255, 0.1)', // Light borders
        'ds-text': '#e2e8f0',           // Main text (slate-200)
        'ds-text-muted': '#64748b',     // Muted text (slate-500)
        'ds-blue': '#818cf8',           // Indigo-400 (neon blue)
        'ds-green': '#34d399',          // Emerald-400
        'ds-red': '#f87171',            // Red-400
        'ds-yellow': '#fbbf24',         // Amber-400
        'ds-terminal': 'rgba(0, 0, 0, 0.4)', // Translucent terminal
        
        // Primary accent - Indigo/Blue glow
        primary: "#6366f1",             // Indigo-500
        accent: "#06b6d4",              // Cyan-500
        success: "#10b981",             // Emerald-500
        
        // Legacy VSC aliases (mapped to deep space)
        'vsc-bg': '#050508',
        'vsc-sidebar': 'rgba(15, 23, 42, 0.5)',
        'vsc-panel': 'rgba(30, 41, 59, 0.6)',
        'vsc-input': 'rgba(51, 65, 85, 0.5)',
        'vsc-hover': 'rgba(255, 255, 255, 0.03)',
        'vsc-border': 'rgba(255, 255, 255, 0.05)',
        'vsc-border-light': 'rgba(255, 255, 255, 0.1)',
        'vsc-text': '#e2e8f0',
        'vsc-text-muted': '#64748b',
        'vsc-blue': '#818cf8',
        'vsc-green': '#34d399',
        'vsc-red': '#f87171',
        'vsc-yellow': '#fbbf24',
        'vsc-terminal': 'rgba(0, 0, 0, 0.4)',
      },
      fontFamily: {
        sans: ['Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Consolas', 'Courier New', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      borderRadius: {
        'vsc': '2px',
      },
      boxShadow: {
        'glow-sm': '0 0 10px rgba(99, 102, 241, 0.3)',
        'glow': '0 0 20px rgba(99, 102, 241, 0.4)',
        'glow-lg': '0 0 30px rgba(99, 102, 241, 0.5)',
      },
    },
  },
  plugins: [],
}
