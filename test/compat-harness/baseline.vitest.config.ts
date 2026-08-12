import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      src: '/home/codex/risu-baseline-71c476e9c/src',
    },
    conditions: ['browser'],
  },
  server: {
    fs: {
      allow: ['/home/codex/risuai-fastify', '/home/codex/risu-baseline-71c476e9c'],
    },
  },
  test: {
    allowOnly: false,
    environment: 'happy-dom',
    pool: 'threads',
    include: ['test/compat-harness/baseline.runner.ts'],
    setupFiles: ['vitest.setup.ts'],
    testTimeout: 120_000,
  },
})
