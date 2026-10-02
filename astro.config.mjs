// @ts-check
import { defineConfig } from 'astro/config';

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  // Update to your production domain (used for canonical URL / sitemap-style links).
  site: 'https://emicalc.pages.dev',
  output: 'static',
  build: {
    // Inline small stylesheets to save a request on first paint.
    inlineStylesheets: 'auto',
  },
});
