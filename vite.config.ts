import { defineConfig } from 'vite'

// Link previews need absolute URLs. Set SITE_URL (with a trailing slash) when building for another host.
const SITE_URL = process.env.SITE_URL ?? 'https://bdebut01.github.io/flight-heatmap/'

// Relative base so the build works from any static host path (e.g. GitHub Pages project sites).
export default defineConfig({
  base: './',
  plugins: [{ name: 'site-url', transformIndexHtml: html => html.replaceAll('__SITE_URL__', SITE_URL) }],
})
