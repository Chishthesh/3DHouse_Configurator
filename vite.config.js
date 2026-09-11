import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import saveTexturePlugin from './vite-plugin-save-texture.js';

export default defineConfig({
  plugins: [react(), saveTexturePlugin()],
  server: {
    // Honour PORT when the launcher assigns one, so a stale dev server on the
    // default port doesn't block a new run.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
});
