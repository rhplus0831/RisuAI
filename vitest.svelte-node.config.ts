import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineProject } from 'vitest/config'
import { excludeUiCoverageTests, uiCoverageTestFiles } from './vitest.ui-coverage-tests'

export default defineProject({
  plugins: [svelte()],
  resolve: {
    alias: {
      src: '/src',
    },
    conditions: ['browser'],
  },
  test: {
    name: 'frontend-svelte-node',
    allowOnly: false,
    pool: 'threads',
    environment: './vitest.svelte-node.environment.ts',
    setupFiles: ['vitest.setup.ts'],
    include: ['**/*.svelte-node.test.ts'],
    exclude: ['**/node_modules/**', 'server/**', ...(excludeUiCoverageTests ? uiCoverageTestFiles : [])],
  },
})
