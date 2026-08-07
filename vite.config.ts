import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-router-dom',
      'zustand',
      'zustand/middleware',
      'zustand/shallow',
      'sonner',
      'framer-motion',
      'lucide-react',
      'reactflow',
      'cmdk',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@dnd-kit/utilities',
      'date-fns',
      'dompurify',
      'clsx',
      'tailwind-merge',
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:25584',
        changeOrigin: true,
        ws: true,
      },
    },
    // Pre-transform critical modules on startup to reduce waterfall
    warmup: {
      clientFiles: ['./src/main.tsx', './src/App.tsx'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Third-party vendors only. Keep app code in default chunks
          // to avoid circular chunk graph warnings.
          if (id.includes('node_modules')) {
            if (
              id.includes('react') ||
              id.includes('react-dom') ||
              id.includes('react-router-dom')
            ) {
              return 'vendor-react';
            }
            if (
              id.includes('lucide-react') ||
              id.includes('framer-motion') ||
              id.includes('sonner')
            ) {
              return 'vendor-ui';
            }
            return undefined;
          }

          return undefined;
        },
      },
    },
  },
});
