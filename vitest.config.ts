import { defineConfig } from 'vitest/config'
import { uiCoverageSupportFiles } from './vitest.ui-coverage-tests'

export default defineConfig({
  test: {
    allowOnly: false,
    projects: ['./vitest.node.config.ts', './vitest.svelte-node.config.ts', './vitest.dom.config.ts'],
    coverage: {
      exclude: [...uiCoverageSupportFiles],
    },
  },
})
