import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer only. Served from the app:// protocol by the main process, so asset URLs stay relative.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, target: 'chrome140' },
});
