import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages (/aztec/), Netlify, Vercel or any sub-path.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: { host: true },
});
