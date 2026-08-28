import { defineProject } from 'vitest/config'
import {
  explicitDomTestFileGlobs,
  frontendTestFileGlob,
  legacyDomTestFiles,
  svelteNodeTestFileGlob,
} from './vitest.frontend-routing'
import { excludeUiCoverageTests, uiCoverageTestFiles } from './vitest.ui-coverage-tests'

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
    include: [frontendTestFileGlob],
    exclude: [
      '**/node_modules/**',
      'server/**',
      svelteNodeTestFileGlob,
      ...explicitDomTestFileGlobs,
      ...legacyDomTestFiles,
      ...(excludeUiCoverageTests ? uiCoverageTestFiles : []),
    ],
  },
})
