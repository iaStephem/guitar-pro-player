import { alphaTab } from '@coderline/alphatab-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  define: {
    __BASE__: JSON.stringify('./'),
  },
  plugins: [alphaTab()],
});
