import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' lets the built app work from any folder or sub-path (Netlify, Vercel, GitHub Pages, etc.)
export default defineConfig({
  base: './',
  plugins: [react()],
});
