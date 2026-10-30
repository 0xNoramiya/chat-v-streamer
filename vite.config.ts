import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ['/api', '/ws', '/tts', '/auth', '/frames'].map((p) => [
        p,
        { target: 'http://127.0.0.1:8787', ws: true },
      ]),
    ),
  },
});
