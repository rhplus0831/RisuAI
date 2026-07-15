import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

const explicitGateTests = ['src/ts/__tests__/**/*.test.ts', 'src/lib/_audit/**/*.test.ts']
const includeExplicitGates = process.env.RISU_TEST_INCLUDE_GATES === 'true'

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      src: '/src',
    },
    conditions: ['browser'],
  },
  test: {
    allowOnly: false,
    environment: 'happy-dom',
    setupFiles: ['vitest.setup.ts'],
    exclude: ['**/node_modules/**', 'server/**', ...(includeExplicitGates ? [] : explicitGateTests)],
  },
})
