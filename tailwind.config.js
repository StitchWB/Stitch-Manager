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
        // Primary accent
        primary: "#6366f1",             // Indigo-500
        accent: "#06b6d4",              // Cyan-500
        success: "#10b981",             // Emerald-500
        
        // Deep Space Void - Core backgrounds (never pure black)
        'void': {
          'deep': '#0B0C15',            // Rich dark background
          'base': '#050508',            // Main app background
          'card': 'rgba(19, 20, 31, 0.8)', // Card/container bg
        },
        
        // VS Code / Deep Space Theme
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
        
        // Deep Space Void - Surface colors
        'surface': {
          'light': 'rgba(255, 255, 255, 0.05)',
          'lighter': 'rgba(255, 255, 255, 0.08)',
          'glass': 'rgba(255, 255, 255, 0.03)',
        },
        // Deep Space Void - Glow colors
        'glow': {
          'purple': 'rgba(139, 92, 246, 0.3)',
          'blue': 'rgba(59, 130, 246, 0.3)',
        },
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
        'glow-sm': '0 0 10px rgba(139, 92, 246, 0.2)',
        'glow': '0 0 20px rgba(99, 102, 241, 0.4)',
        'glow-md': '0 0 20px rgba(139, 92, 246, 0.3)',
        'glow-lg': '0 0 30px rgba(99, 102, 241, 0.5)',
        'glow-purple': '0 0 15px rgba(124, 58, 237, 0.1)',
        'glow-blue': '0 0 15px rgba(59, 130, 246, 0.1)',
        'card': '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
        'action-bar': '0 -5px 15px rgba(0, 0, 0, 0.5)',
      },
      backdropBlur: {
        'glass': '10px',
      },
    },
  },
  plugins: [],
}
