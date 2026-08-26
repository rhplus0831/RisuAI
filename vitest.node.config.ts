import { defineProject } from 'vitest/config'
import { nodeTestFiles } from './vitest.node-tests'
import { excludeUiCoverageTests, uiCoverageTestFiles } from './vitest.ui-coverage-tests'

const uiCoverageTestFileSet = new Set<string>(uiCoverageTestFiles)

export default defineProject({
  resolve: {
    alias: {
      src: '/src',
    },
    conditions: ['browser'],
  },
  test: {
    name: 'frontend-node',
    allowOnly: false,
    pool: 'threads',
    environment: 'node',
    setupFiles: ['vitest.setup.ts'],
    include: excludeUiCoverageTests
      ? nodeTestFiles.filter((file) => !uiCoverageTestFileSet.has(file))
      : [...nodeTestFiles],
  },
})
