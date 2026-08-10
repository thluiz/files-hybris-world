import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://files.hybris.world',
  // Estático de propósito: toda a lógica de acesso vive na Pages Function em
  // functions/api/download.ts, não em SSR.
  output: 'static',
});
