import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineProject } from 'vitest/config'
import { nodeTestFiles } from './vitest.node-tests'
import { excludeUiCoverageTests, uiCoverageTestFiles } from './vitest.ui-coverage-tests'

const explicitGateTests = ['src/ts/__tests__/**/*.test.ts', 'src/lib/_audit/**/*.test.ts']
const includeExplicitGates = process.env.RISU_TEST_INCLUDE_GATES === 'true'

export default defineProject({
  plugins: [svelte()],
  resolve: {
    alias: {
      src: '/src',
    },
    conditions: ['browser'],
  },
  test: {
    name: 'frontend-dom',
    allowOnly: false,
    pool: 'threads',
    environment: 'happy-dom',
    setupFiles: ['vitest.setup.ts', 'vitest.dom.setup.ts'],
    exclude: [
      '**/node_modules/**',
      'server/**',
      ...nodeTestFiles,
      ...(includeExplicitGates ? [] : explicitGateTests),
      ...(excludeUiCoverageTests ? uiCoverageTestFiles : []),
    ],
  },
})
