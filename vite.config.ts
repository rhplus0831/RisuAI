import { defineConfig } from 'vite'
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import wasm from 'vite-plugin-wasm'
import strip from '@rollup/plugin-strip'
import tailwindcss from '@tailwindcss/vite'
// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  return {
    plugins: [
      svelte({
        preprocess: vitePreprocess(),
        onwarn: (warning, handler) => {
          // disable a11y warnings
          if (warning.code.startsWith('a11y-')) return
          handler(warning)
        },
      }),
      tailwindcss(),
      wasm(),
      command === 'build'
        ? strip({
            include: '**/*.(mjs|js|svelte|ts)',
          })
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
    },

    optimizeDeps: {
      exclude: ['@browsermt/bergamot-translator'],
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
