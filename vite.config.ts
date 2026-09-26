import { defineConfig, loadEnv } from 'vite'

// Link previews need absolute URLs. SITE_URL comes from the environment or a gitignored .env.local;
// without it the build leaves those tags out rather than guess the address.
export default defineConfig(({ mode }) => {
  const raw = loadEnv(mode, process.cwd(), '').SITE_URL ?? ''
  const site = raw && !raw.endsWith('/') ? `${raw}/` : raw
  return {
    base: './',   // relative, so the build works from any static host path
    plugins: [{
      name: 'site-url',
      transformIndexHtml: (html: string) => site ? html.replaceAll('__SITE_URL__', site) : html.replace(/^.*__SITE_URL__.*\n/gm, ''),
    }],
  }
})
