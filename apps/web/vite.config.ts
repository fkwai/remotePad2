import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1', port: 6021, strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:6020',
      '/ws': { target: 'ws://127.0.0.1:6020', ws: true },
    },
  },
});
