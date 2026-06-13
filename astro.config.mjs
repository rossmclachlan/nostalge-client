import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'

// Static build for GitHub Pages.
// `base` must match the repository name so assets resolve under
// https://<user>.github.io/nostalge-client/
export default defineConfig({
  site: 'https://rossmclachlan.github.io',
  base: '/nostalge-client',
  output: 'static',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
})
