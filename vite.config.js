import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue()], build: { target: 'es2022' },
  server: { host: '127.0.0.1', port: 5180, strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4000', '/uploads': 'http://127.0.0.1:4000',
      '/socket.io': { target: 'http://127.0.0.1:4000', ws: true } }
  },
  preview: { host: '127.0.0.1', port: 5182, strictPort: true }
});
