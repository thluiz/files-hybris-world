import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://files.hybris.world',
  // Deliberately static: all access logic lives in the Pages Function at
  // functions/api/download.ts, not in SSR.
  output: 'static',
});
