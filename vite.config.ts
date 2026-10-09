import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: 'app/renderer',
  base: './',
  publicDir: path.resolve('assets'),
  plugins: [react()],
  build: { outDir: path.resolve('dist/ui'), emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
