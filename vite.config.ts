import { defineConfig } from 'vite'
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import wasm from 'vite-plugin-wasm'
import strip from '@rollup/plugin-strip'
import tailwindcss from '@tailwindcss/vite'
import { createBundleBoundaryReportPlugin } from './util/bundle-boundary-report'
import { createViteBuildWarningPolicy } from './util/vite-warning-policy'
// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  return {
    plugins: [
      svelte({
        preprocess: vitePreprocess(),
      }),
      tailwindcss(),
      wasm(),
      command === 'build'
        ? strip({
            include: '**/*.(mjs|js|svelte|ts)',
          })
        : null,
      command === 'build' && process.env.VITE_FAST_BOOTSTRAP_REPORT === 'TRUE'
        ? createBundleBoundaryReportPlugin(process.cwd())
        : null,
    ],

    clearScreen: false,
    server: {
      host: '0.0.0.0', // listen on all addresses
      port: 5174,
      strictPort: true,
      watch: {
        ignored: ['**/data/**', '**/dist/**', '**/test-results/**'],
      },
      proxy: {
        '/api': {
          target: process.env.RISU_API_PROXY_TARGET ?? 'http://localhost:6002',
          changeOrigin: true,
        },
      },
    },
    envPrefix: ['VITE_'],
    build: {
      target: 'baseline-widely-available',
      minify: 'oxc',
      chunkSizeWarningLimit: 2000,
      manifest: process.env.VITE_FASTIFY_BROWSER_SMOKE === 'TRUE' ? 'vite-assets-manifest.json' : false,
      rolldownOptions: {
        onLog: createViteBuildWarningPolicy(process.cwd()),
      },
    },

    optimizeDeps: {
      needsInterop: ['@mlc-ai/web-tokenizers'],
    },

    resolve: {
      alias: {
        src: '/src',
      },
    },
    worker: {
      format: 'es',
    },
  }
})
