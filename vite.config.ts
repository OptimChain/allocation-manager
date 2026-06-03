import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const useMockApi = process.env.VITE_MOCK_API === '1';

// https://vitejs.dev/config/
export default defineConfig(async () => {
  const plugins = [react()];

  if (useMockApi) {
    const { mockApiPlugin } = await import('./vite-mock-api');
    plugins.push(mockApiPlugin());
  }

  return {
    plugins,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    preview: {
      port: 5174,
      strictPort: true,
    },
  };
});
