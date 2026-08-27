import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineProject } from 'vitest/config'
import { svelteNodeTestFiles } from './vitest.svelte-node-tests'
import { excludeUiCoverageTests, uiCoverageTestFiles } from './vitest.ui-coverage-tests'

const uiCoverageTestFileSet = new Set<string>(uiCoverageTestFiles)

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
    include: excludeUiCoverageTests
      ? svelteNodeTestFiles.filter((file) => !uiCoverageTestFileSet.has(file))
      : [...svelteNodeTestFiles],
  },
})
