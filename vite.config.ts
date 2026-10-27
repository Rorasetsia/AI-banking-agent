import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  // Keep vh fallbacks in distributed CSS for older embedded browsers.
  build: { outDir: 'dist', cssTarget: 'chrome100' },
});
