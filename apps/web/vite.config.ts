import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // JDM Editor ships Monaco and its language tooling in one lazy vendor chunk (~6.5 MB).
    // The entry stays small; this threshold only suppresses that deferred vendor warning.
    chunkSizeWarningLimit: 7000,
  },
  server: { port: 5173, proxy: { '/api': { target: 'http://127.0.0.1:3001', rewrite: path => path.replace(/^\/api/, '') } } },
});
