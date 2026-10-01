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
          'base': '#050508',            // Main app background
        },
        
        // VS Code / Deep Space Theme
        'vsc-bg': '#050508',
        'vsc-sidebar': 'rgba(10, 12, 20, 0.7)',
        'vsc-sidebar-solid': '#111116',
        'vsc-panel': 'rgba(15, 18, 30, 0.7)',
        'vsc-panel-solid': '#0f121e',
        'vsc-input': 'rgba(20, 25, 40, 0.6)',
        'vsc-hover': 'rgba(255, 255, 255, 0.04)',
        'vsc-border': 'rgba(255, 255, 255, 0.06)',
        'vsc-border-light': 'rgba(255, 255, 255, 0.10)',
        'vsc-text': '#e2e8f0',
        'vsc-text-muted': '#94a3b8',
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
      boxShadow: {
        'glow-primary': '0 0 10px rgba(99, 102, 241, 0.2)',
        'glow-danger': '0 0 10px rgba(239, 68, 68, 0.25)',
        'glow-purple': '0 0 15px rgba(124, 58, 237, 0.1)',
        'glow-blue': '0 0 15px rgba(59, 130, 246, 0.1)',
        'action-bar': '0 -5px 15px rgba(0, 0, 0, 0.5)',
      },
    },
  },
  plugins: [],
}
