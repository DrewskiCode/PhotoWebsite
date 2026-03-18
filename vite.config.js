import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        gallery: resolve(__dirname, 'gallery.html'),
        films: resolve(__dirname, 'films.html'),
        about: resolve(__dirname, 'about.html'),
        awards: resolve(__dirname, 'awards.html'),
        contact: resolve(__dirname, 'contact.html'),
      },
    },
  },
});
