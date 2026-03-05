import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import cfgPlugin from './vite-plugin-cfg';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), cfgPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
