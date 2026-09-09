import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// SvelteKit 3: configuration lives in the Vite plugin (svelte.config.js is gone)
export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter({ out: 'build' })
    })
  ],
  server: {
    port: 1404,
    strictPort: true
  }
});
